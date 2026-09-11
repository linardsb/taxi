/**
 * #193 investigation instrument. NOT shipped source.
 *
 * Jest's default sequencer has no fixed order: with no timing cache it sorts
 * by file SIZE descending, with one it sorts by recorded DURATION descending.
 * That is why two runs of the same tree can execute the 76 files in different
 * orders — the property that made every previous look at this flake confusing.
 *
 * This sequencer pins the order to the list in $PINNED_ORDER (one repo-relative
 * spec path per line, the order a previous run was observed to use), so a red
 * run and a green run can be compared with the order held CONSTANT. Files not
 * in the list keep their default position after the pinned ones.
 */
const { readFileSync } = require('node:fs');

const Sequencer = require('@jest/test-sequencer').default;

const listFile = process.env.PINNED_ORDER;
const rank = new Map();
if (listFile) {
  const lines = readFileSync(listFile, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const p = line.trim();
    if (p) rank.set(p, i);
  });
}

class PinnedSequencer extends Sequencer {
  sort(tests) {
    if (!rank.size) return super.sort(tests);
    const keyOf = (t) => t.path.split('/services/api/src/').pop();
    return [...tests].sort((a, b) => {
      const ra = rank.has(keyOf(a)) ? rank.get(keyOf(a)) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(keyOf(b)) ? rank.get(keyOf(b)) : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.path < b.path ? -1 : 1;
    });
  }
}

module.exports = PinnedSequencer;
