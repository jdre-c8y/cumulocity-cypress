/**
 * The browser half of the probe. Deliberately the dumbest thing that can work.
 *
 * It reads attributes and reports a flat list of nodes with parent indices. It decides nothing:
 * which attributes the ladder may see is enforced by the list below, and every other reduction
 * happens in node, where it is tested without a browser.
 *
 * Plain JavaScript, and self-contained, because it is copied into the target repo's working
 * area and bundled by that repo's own Cypress. It is never installed there and never committed.
 *
 * Facts leave the browser through `cy.writeFile` rather than through a node task. The design
 * called for a task, following the plugin pattern the library already establishes - but a task
 * has to be registered in the target repo's own `setupNodeEvents`, and c8y-cygen does not modify
 * the target repo. The requirement that mattered was schema validation at the node boundary, and
 * that is met by validating each payload on read: a malformed payload is the input to every
 * downstream decision and must not fail silently.
 *
 * One file per collect, written as it happens, so a probe that dies partway still returns
 * everything it already collected. That is normal, not exceptional.
 */

// The ladder's whole attribute vocabulary. An attribute absent here never leaves the browser,
// which is how [c8yicon], any ng-*, [value] and [href] are banned by construction rather than
// by documentation.
var LADDER_ATTRS = [
  'data-cy',
  'name',
  'formcontrolname',
  'id',
  'role',
  'aria-label',
  'title',
  'placeholder',
  'type',
  'tabindex'
];

var MAX_TEXT = 200;
var MAX_NODES = 400;

function factsDir() {
  return Cypress.env('c8yCygenFactsDir');
}

function visibilityOf(el) {
  var style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return 'hidden';
  }
  var rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return 'hidden';

  // Clipped is its own state because the preview-versus-saved hazard changes neither the count
  // nor the path, only the visible area.
  var parent = el.parentElement;
  while (parent) {
    var parentStyle = window.getComputedStyle(parent);
    var overflow = parentStyle.overflow + parentStyle.overflowY + parentStyle.overflowX;
    if (/(auto|scroll|hidden)/.test(overflow)) {
      var box = parent.getBoundingClientRect();
      if (rect.bottom > box.bottom + 1 || rect.right > box.right + 1 || rect.top < box.top - 1) {
        return 'clipped';
      }
    }
    parent = parent.parentElement;
  }
  return 'visible';
}

function attrsOf(el) {
  var attrs = {};
  for (var i = 0; i < LADDER_ATTRS.length; i++) {
    var value = el.getAttribute(LADDER_ATTRS[i]);
    if (value !== null && value !== '') attrs[LADDER_ATTRS[i]] = value;
  }
  return attrs;
}

function classesOf(el) {
  var out = [];
  for (var i = 0; i < el.classList.length; i++) out.push(el.classList.item(i));
  return out;
}

function describeNode(el, index, parentIndex) {
  return {
    i: index,
    parent: parentIndex,
    tag: el.tagName.toLowerCase(),
    attrs: attrsOf(el),
    classes: classesOf(el),
    text: (el.textContent || '').slice(0, MAX_TEXT),
    visibility: visibilityOf(el)
  };
}

/**
 * Breadth-first, so a dump that hits the cap still holds whole levels rather than one deep
 * spine. Returns the nodes and, when `needle` is given, the index it landed on.
 */
function walk(root, needle) {
  var nodes = [describeNode(root, 0, -1)];
  var found = root === needle ? 0 : -1;
  var queue = [{ el: root, index: 0 }];
  while (queue.length > 0 && nodes.length < MAX_NODES) {
    var current = queue.shift();
    var children = current.el.children;
    for (var i = 0; i < children.length && nodes.length < MAX_NODES; i++) {
      var index = nodes.length;
      nodes.push(describeNode(children[i], index, current.index));
      if (children[i] === needle) found = index;
      queue.push({ el: children[i], index: index });
    }
  }
  return { nodes: nodes, found: found };
}

var written = 0;

function writeFacts(payload) {
  written += 1;
  var name = String(written).padStart(3, '0');
  return cy.writeFile(factsDir() + '/' + name + '-' + payload.kind + '.json', payload);
}

/**
 * Marks where the probe looks. Always scoped: an unscoped Cumulocity page yields a candidate
 * table far larger than the flow needs, and an automatic collect has no way to choose a scope,
 * so it would be unscoped by construction.
 */
Cypress.Commands.add('c8yCygenCollect', function (options) {
  var label = options.label;
  var within = options.within;
  return cy.get(within).then(function ($scope) {
    var nodes = [];
    $scope.each(function (_i, el) {
      var offset = nodes.length;
      var walked = walk(el, null).nodes;
      for (var j = 0; j < walked.length; j++) {
        walked[j].i += offset;
        if (walked[j].parent >= 0) walked[j].parent += offset;
        nodes.push(walked[j]);
      }
    });
    return writeFacts({
      kind: 'collect',
      label: label,
      within: within,
      observedAt: new Date().toISOString(),
      nodes: nodes
    });
  });
});

/**
 * Resolves a provisional guess, records which candidate row it matched, and yields the element
 * onward. The probe holds the element at the moment it acts on it, so recording this costs
 * nothing - and it is what makes a resolved selector derived from facts rather than asserted
 * against them.
 *
 * The match count travels with it. Resolution refuses on a mismatch against the step's declared
 * cardinality rather than silently taking the first of several, which is what Cypress would do.
 */
Cypress.Commands.add('c8yCygenProvisional', function (stepId, guess) {
  var chain = guess.within
    ? cy.get(guess.within).find(guess.tag || '*')
    : cy.get(guess.tag || 'body');
  if (guess.text) chain = chain.contains(guess.text);
  if (guess.matches) chain = chain.contains(new RegExp(guess.matches));

  return chain.then(function ($all) {
    var matchCount = $all.length;
    var $one = typeof guess.nth === 'number' ? $all.eq(guess.nth) : $all.first();
    var el = $one.get(0);
    var root = guess.within
      ? el.closest(guess.within) || el.ownerDocument.body
      : el.ownerDocument.body;
    var walked = walk(root, el);

    return writeFacts({
      kind: 'provisional',
      stepId: stepId,
      label: stepId,
      within: guess.within || null,
      observedAt: new Date().toISOString(),
      matchCount: matchCount,
      matchedIndex: walked.found,
      nodes: walked.nodes
    }).then(function () {
      return $one;
    });
  });
});
