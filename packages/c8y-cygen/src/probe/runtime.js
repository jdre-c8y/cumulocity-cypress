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

// A coarse guard against shipping a large textarea across the boundary. Node applies the final,
// smaller cap. Both DROP rather than clip: a clipped value read back as an equality is a lie,
// and the only way to be sure none exists is for no stage to ever produce one.
var MAX_VALUE = 200;

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

/**
 * What the element holds, read from the `.value` PROPERTY and never from the attribute.
 *
 * This is the whole reason the field exists. For a databound input the `value` attribute holds
 * the markup's initial value or nothing at all, while the property holds what is on the screen -
 * so reading the attribute would produce a fact that is wrong in exactly the case that needs it.
 *
 * `[value]` stays banned as a selector part, which is a different question: LADDER_ATTRS still
 * has no entry for it, so no selector can ever be built from what this reports.
 *
 * A password is never read. Facts are written to disk and then sent to a model, and a probe that
 * walks a login form would otherwise put the tenant's credentials in both. The conventions file
 * already records only env key names for the same reason; this is that rule, one layer down.
 */
function valueOf(el) {
  if (el.type === 'password' || /password/i.test(el.getAttribute('autocomplete') || '')) {
    return undefined;
  }
  var v = el.value;
  if (typeof v !== 'string' || v === '' || v.length > MAX_VALUE) return undefined;
  return v;
}

function classesOf(el) {
  var out = [];
  for (var i = 0; i < el.classList.length; i++) out.push(el.classList.item(i));
  return out;
}

/**
 * The element's OWN text: the concatenation of its direct text children, and nothing its
 * descendants carry.
 *
 * This is read here, in the browser, because here is the only place it can be read exactly. The
 * payload used to carry `el.textContent` - the whole subtree - truncated at 200 characters, and
 * node then tried to recover own text by subtracting each child's text from the parent's. Both
 * strings had been truncated independently, so on any large subtree neither contains the other,
 * the subtraction quietly did nothing, and a wrapper kept the entire panel's text: exactly the
 * row that matches every `contains` and makes the ladder's uniqueness measurement meaningless.
 */
function ownTextOf(el) {
  var out = '';
  for (var i = 0; i < el.childNodes.length; i++) {
    var node = el.childNodes[i];
    if (node.nodeType === 3) out += node.nodeValue || '';
  }
  return out.replace(/\s+/g, ' ').trim();
}

function describeNode(el, index, parentIndex) {
  return {
    i: index,
    parent: parentIndex,
    tag: el.tagName.toLowerCase(),
    attrs: attrsOf(el),
    classes: classesOf(el),
    text: ownTextOf(el).slice(0, MAX_TEXT),
    value: valueOf(el),
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
 * The network watcher.
 *
 * Ticket 02's rule 3 says a fabricated response body must be derived by recorded mutation from
 * a response the probe actually observed. Somewhere has to do the observing, and this is it.
 *
 * Two properties are load-bearing:
 *
 *   - `middleware: true` makes this a pass-through observer rather than a stub. It runs before
 *     any other intercept and lets the request continue untouched, so the probe never changes
 *     what the application sees. A probe that alters the traffic it is measuring is worse than
 *     no probe: every fact it collects is then contingent on itself.
 *   - It starts in a root-level `beforeEach`, which registers when this file is imported and so
 *     runs before the spec's own hooks. The page-load traffic is the traffic that matters -
 *     Cockpit resolves the dashboard once, on boot - and an intercept registered after the
 *     visit catches none of it.
 *
 * Only JSON bodies are kept. A stub can derive from nothing else, and a page's scripts, fonts
 * and images would swamp the payload with exchanges no IR can ever name.
 */
var MAX_BODY_CHARS = 20000;
var MAX_EXCHANGES = 200;

var observed = [];
var dropped = 0;

function recordExchange(req, res) {
  if (observed.length >= MAX_EXCHANGES) {
    // Counted, not silent. An absent exchange is otherwise indistinguishable from a call the
    // application never made, and the model told "no probe observed that" will re-probe and
    // truncate in exactly the same place.
    dropped += 1;
    return;
  }

  var body = res.body;
  // A string that happens to be JSON is still JSON. Cypress parses by content-type and the
  // platform does not always send one.
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return;
    }
  }
  if (body === null || typeof body !== 'object') return;

  var entry = { method: req.method, url: req.url, status: res.statusCode };

  var text;
  try {
    text = JSON.stringify(body);
  } catch {
    // A body that will not serialise cannot reach node, so it cannot anchor a stub either.
    return;
  }
  if (text.length > MAX_BODY_CHARS) {
    // Dropped whole, never clipped. A truncated JSON document that still parses would anchor a
    // stub to a fiction that looks observed, which is the one outcome worth spending a byte to
    // prevent.
    entry.bodyDropped = true;
  } else {
    entry.body = body;
  }

  // The dynamic half of the run manifest: a 201 carrying an id created real state.
  if (res.statusCode === 201 && body.id !== undefined) {
    entry.createdId = String(body.id);
  }

  observed.push(entry);
}

/**
 * Whether this request is worth buffering a response for.
 *
 * Attaching a response listener makes Cypress hold the whole body so the handler can read it,
 * and a `**` middleware route sees every asset the application loads - bundles, fonts, images.
 * Buffering those costs wall clock on a run whose wall clock is already a measured hazard, and
 * none of them could ever anchor a stub. Filtered on the request, before anything is held.
 */
function watchable(req) {
  if (req.resourceType !== 'xhr' && req.resourceType !== 'fetch') return false;
  return !/\.(js|css|svg|png|jpe?g|gif|woff2?|ttf|ico|map)(\?|$)/i.test(req.url);
}

beforeEach(function () {
  observed = [];
  dropped = 0;
  cy.intercept({ url: '**', middleware: true }, function (req) {
    if (!watchable(req)) return;
    req.on('response', function (res) {
      recordExchange(req, res);
    });
  });
});

/**
 * Flushes what the watcher has seen since the last flush.
 *
 * Since the last flush, not since the start: a probe walks a flow, and which exchanges belong
 * to which state of that flow is exactly the thing a later `stub` needs to know. Draining keeps
 * each payload's label meaningful.
 *
 * It rides on the collect command rather than being an IR verb of its own. A collect point is
 * already the model saying "look here, in this state", and that is the same instant the network
 * question is asked - so the facts arrive together and the IR gains no fourth thing to learn.
 * The `.network` suffix keeps the two payloads from colliding on one label, which would send
 * the second through the reader's duplicate-label rename and leave the ids reading `page~2#0`.
 */
function writeNetwork(label) {
  var batch = observed;
  var lost = dropped;
  observed = [];
  dropped = 0;
  return writeFacts({
    kind: 'network',
    label: label + '.network',
    observedAt: new Date().toISOString(),
    droppedExchanges: lost,
    requests: batch
  });
}

/** Caps the inventory below. A page with more distinct components than this has other problems. */
var MAX_COMPONENTS = 120;

/**
 * Every custom element on the page, by tag name, with how many of it there are.
 *
 * This is what a missed scope needs. A scope is a guess - on the first look at a page nothing
 * has been measured yet, so it can only be a guess - and the question behind every wrong guess
 * is the same one: what are these things actually called. So the answer travels back with the
 * miss. It is a few dozen short strings and it does not truncate, which a page-wide walk
 * bounded at MAX_NODES would.
 */
function pageComponents(body) {
  var counts = {};
  var all = body.getElementsByTagName('*');
  for (var i = 0; i < all.length; i++) {
    var tag = all[i].tagName.toLowerCase();
    if (tag.indexOf('-') === -1) continue;
    counts[tag] = (counts[tag] || 0) + 1;
  }
  return Object.keys(counts)
    .sort()
    .slice(0, MAX_COMPONENTS)
    .map(function (tag) {
      return { tag: tag, count: counts[tag] };
    });
}

/**
 * Marks where the probe looks. Always scoped: an unscoped Cumulocity page yields a candidate
 * table far larger than the flow needs, and an automatic collect has no way to choose a scope,
 * so it would be unscoped by construction.
 *
 * A scope that matches nothing costs its own rows and nothing else. `cy.get(within)` fails the
 * test instead, and one failed collect takes every later collect in the same probe with it - so
 * a single wrong guess returns zero facts, and the next iteration guesses just as blindly as
 * the one that missed. The miss is recorded instead, carrying the page's component inventory,
 * which answers the question the wrong guess was asking.
 */
Cypress.Commands.add('c8yCygenCollect', function (options) {
  var label = options.label;
  var within = options.within;
  return cy.get('body').then(function ($body) {
    var observedAt = new Date().toISOString();
    var $scope = null;
    try {
      $scope = within ? $body.find(within) : $body;
    } catch {
      // A selector the model made up may not even parse. That is a miss like any other.
      $scope = null;
    }

    if (!$scope || $scope.length === 0) {
      writeNetwork(label);
      return writeFacts({
        kind: 'collect',
        label: label,
        within: within,
        scopeMissed: true,
        pageComponents: pageComponents($body[0]),
        observedAt: observedAt,
        nodes: []
      });
    }

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
    writeNetwork(label);
    return writeFacts({
      kind: 'collect',
      label: label,
      within: within,
      scopeMissed: false,
      observedAt: observedAt,
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
/**
 * How many elements the guess could have meant, measured over the same own text the ladder's
 * rows carry.
 *
 * Counted here rather than off the `.contains()` result, because `.contains()` yields exactly
 * ONE element - so `$all.length` was always 1 for any guess carrying `text` or `matches`, which
 * is precisely the vague guess the count exists to flag. The refusal below promised to stop
 * silently taking the first of several and could never fire.
 *
 * Synchronous, and deliberately after the retrying chain has already resolved: the DOM has
 * settled by then, so a plain query sees what the assertion saw.
 */
function countMatches(guess) {
  var $all = Cypress.$(guess.within || 'body').find(guess.tag || '*');
  var re = guess.matches ? new RegExp(guess.matches) : null;
  var n = 0;
  $all.each(function (_i, el) {
    var text = ownTextOf(el);
    if (guess.text && text.indexOf(guess.text) === -1) return;
    if (re && !re.test(text)) return;
    n += 1;
  });
  return n;
}

Cypress.Commands.add('c8yCygenProvisional', function (stepId, guess) {
  var chain = guess.within
    ? cy.get(guess.within).find(guess.tag || '*')
    : cy.get(guess.tag || 'body');
  if (guess.text) chain = chain.contains(guess.text);
  if (guess.matches) chain = chain.contains(new RegExp(guess.matches));

  return chain.then(function ($all) {
    var matchCount = countMatches(guess);
    var $one = typeof guess.nth === 'number' ? $all.eq(guess.nth) : $all.first();
    var el = $one.get(0);
    // An out-of-range `nth` used to die two lines down as "Cannot read properties of undefined
    // (reading 'closest')" - a TypeError inside the probe runtime, which aborts the it() and
    // takes every later collect in the same run with it. The guess is what was wrong; say so.
    if (!el) {
      throw new Error(
        "c8y-cygen probe, step '" + stepId + "': nth is " + guess.nth + ', but the guess matched ' +
          $all.length + ' element(s) here. Indexes start at 0, so the highest usable one is ' +
          ($all.length - 1) + '.'
      );
    }
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
