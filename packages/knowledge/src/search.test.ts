import { describe, expect, it } from 'vitest';
import { KNOWLEDGE } from './corpus/index.js';
import { KNOWLEDGE_JURISDICTIONS, KNOWLEDGE_TOPICS } from './types.js';
import { getArticle, listArticles, renderKnowledge, searchKnowledge } from './search.js';

/**
 * Two kinds of test here, and the first kind matters more.
 *
 * The integrity tests hold the corpus to its own contract — unique ids, real
 * topics, a `related` link that points at something, an authority line on
 * every article that speaks in the voice of a state's law, and a state tag
 * that agrees with the statutes the article actually cites. A broken
 * cross-link, an invented statute cite, or a Florida rule wearing a Texas tag
 * would otherwise reach a client through an answer, and nothing else in the
 * build would catch it.
 *
 * The retrieval tests pin the queries a preparer actually types. They are
 * written against article ids rather than scores, because the scoring
 * constants should be free to move as long as the right article still wins.
 */

describe('corpus integrity', () => {
  it('has unique ids', () => {
    const ids = KNOWLEDGE.map((article) => article.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only declared topics', () => {
    const declared = new Set<string>(KNOWLEDGE_TOPICS);
    for (const article of KNOWLEDGE) {
      expect(article.topics.length).toBeGreaterThan(0);
      for (const topic of article.topics) expect(declared.has(topic)).toBe(true);
    }
  });

  it('resolves every related link', () => {
    const ids = new Set(KNOWLEDGE.map((article) => article.id));
    for (const article of KNOWLEDGE) {
      for (const related of article.related ?? []) {
        expect(ids.has(related), `${article.id} -> ${related}`).toBe(true);
      }
    }
  });

  it('cites authority for everything that is not a product article', () => {
    for (const article of KNOWLEDGE) {
      // `product` is the whole exemption, including for the method articles
      // that only describe how Tangible weighs evidence — those carry both
      // topics precisely so this rule does not have to be widened. A `method`
      // article that states a rule of tax carries the detector's own citation
      // and is caught here if it stops.
      const isProduct = article.topics.includes('product');
      if (isProduct) continue;
      expect(article.authority.length, article.id).toBeGreaterThan(0);
    }
  });

  it('tags a jurisdiction that agrees with the statutes cited', () => {
    const declared = new Set<string>(KNOWLEDGE_JURISDICTIONS);
    for (const article of KNOWLEDGE) {
      if (!article.jurisdiction) continue;
      expect(declared.has(article.jurisdiction), article.id).toBe(true);
      const cites = article.authority.join(' ');
      // The check is on `authority` and deliberately not on `body`. Authority
      // is what becomes a citation, so a Texas section listed there under a
      // Florida tag is the failure this whole facet exists to prevent. The
      // bodies cite Texas sections on purpose — half of what the Florida
      // articles are for is telling a Texas-trained preparer which of their
      // instincts does not travel — and a test that banned that would delete
      // the most useful sentences in the file.
      if (article.jurisdiction === 'tx') expect(cites, article.id).not.toContain('F.S.');
      if (article.jurisdiction === 'fl') expect(cites, article.id).not.toContain('Tax Code');
    }
  });

  it('leaves a jurisdiction off only where the article is genuinely state-agnostic', () => {
    /**
     * An allowlist rather than a rule, because no rule fits. The three
     * `product` articles describe this repository and would read the same in
     * any state; the roll article is about what publishers do across several
     * states at once and cites a Texas section only for the confidentiality
     * that makes the point. Nothing else earns the omission.
     *
     * The test is here to make adding an untagged article a deliberate act. An
     * article whose state nobody established is not state-agnostic, it is
     * unfinished, and it is returned to every engagement.
     */
    const agnostic = new Set([
      'county-data-what-the-roll-holds',
      'product-two-wings',
      'product-findings-and-dispositions',
      'product-ready-and-blockers',
      // The three method articles that describe how this product weighs
      // evidence rather than what a state requires. A confidence threshold is
      // not Texas law. The other five method articles state tax rules, carry
      // citations, and are tagged `tx` like anything else that does.
      'method-kinds-and-effects',
      'method-confidence-tiers',
      'method-register-limits',
    ]);
    const untagged = KNOWLEDGE.filter((article) => !article.jurisdiction).map(
      (article) => article.id,
    );
    expect(new Set(untagged)).toEqual(agnostic);
  });

  it('carries keywords and a body on every article', () => {
    for (const article of KNOWLEDGE) {
      expect(article.keywords.length, article.id).toBeGreaterThan(0);
      expect(article.body.trim().length, article.id).toBeGreaterThan(200);
      expect(article.title.trim().length, article.id).toBeGreaterThan(0);
    }
  });
});

describe('searchKnowledge', () => {
  const topFor = (query: string) => searchKnowledge(query)[0]?.article.id;

  it('finds the extension rule from a plain question', () => {
    expect(topFor('can we get more time to file the rendition')).toBe(
      'extensions-what-a-request-buys',
    );
  });

  it('is not misled by a light verb that happens to be rare', () => {
    expect(
      searchKnowledge('how do we get an extension', { jurisdictions: ['fl'] })[0]?.article.id,
    ).toBe('fl-extensions-what-a-request-buys');
  });

  it('finds the penalty article from a percentage', () => {
    const ids = searchKnowledge('what is the 10 percent penalty for filing late').map(
      (hit) => hit.article.id,
    );
    expect(ids).toContain('penalties-late-and-fraudulent');
  });

  it('keeps a statute cite together as one term', () => {
    const ids = searchKnowledge('what does 25.25(c-1) cover').map((hit) => hit.article.id);
    expect(ids).toContain('corrections-25-25-routes');
  });

  it('finds the exemption from the dollar figure alone', () => {
    const ids = searchKnowledge('is my client under the $125,000 threshold').map(
      (hit) => hit.article.id,
    );
    expect(ids).toContain('exemptions-bpp-threshold');
  });

  it('answers a product question with a product article', () => {
    expect(topFor('why is this return blocked and not ready')).toBe('product-ready-and-blockers');
  });

  it('respects a topic filter', () => {
    const hits = searchKnowledge('deadline', { topics: ['corrections'] });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.article.topics).toContain('corrections');
  });

  it('keeps Florida out of a Texas answer', () => {
    const hits = searchKnowledge('when is the return due and can we extend it', {
      jurisdictions: ['tx'],
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.article.jurisdiction ?? 'tx').toBe('tx');
    expect(hits.map((hit) => hit.article.id)).toContain('deadlines-season');
  });

  it('keeps Texas out of a Florida answer', () => {
    const hits = searchKnowledge('when is the return due and can we extend it', {
      jurisdictions: ['fl'],
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.article.jurisdiction ?? 'fl').toBe('fl');
    expect(hits.map((hit) => hit.article.id)).toContain('fl-deadlines-season');
  });

  it('returns state-agnostic articles under either filter', () => {
    const question = 'why is this return blocked and not ready';
    for (const state of KNOWLEDGE_JURISDICTIONS) {
      const ids = searchKnowledge(question, { jurisdictions: [state] }).map(
        (hit) => hit.article.id,
      );
      expect(ids, state).toContain('product-ready-and-blockers');
    }
  });

  it('combines the topic and jurisdiction filters rather than choosing one', () => {
    const hits = searchKnowledge('penalty for filing a return late', {
      topics: ['penalties'],
      jurisdictions: ['fl'],
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.article.topics).toContain('penalties');
      expect(hit.article.jurisdiction ?? 'fl').toBe('fl');
    }
  });

  it('defines a ghost asset from the phrase a preparer uses', () => {
    const ids = searchKnowledge('what counts as a ghost asset').map((hit) => hit.article.id);
    expect(ids[0]).toBe('method-ghost-assets');
  });

  it('separates a recorded disposal from one that is only suspected', () => {
    const ids = searchKnowledge('assets that look retired but were never marked disposed').map(
      (hit) => hit.article.id,
    );
    expect(ids).toContain('method-suspected-retired');
  });

  it('finds the confidence thresholds from a reviewer question', () => {
    const ids = searchKnowledge('why is this finding low confidence').map((hit) => hit.article.id);
    expect(ids).toContain('method-confidence-tiers');
  });

  it('answers why a screening finding carries no dollar figure', () => {
    const ids = searchKnowledge('screening finding has no number, measured or modeled').map(
      (hit) => hit.article.id,
    );
    expect(ids).toContain('method-kinds-and-effects');
  });

  it('reaches the method articles under a Texas filter without excluding the neutral ones', () => {
    const ids = searchKnowledge('ghost asset confidence and what the register cannot prove', {
      jurisdictions: ['tx'],
    }).map((hit) => hit.article.id);
    expect(ids).toContain('method-ghost-assets');
    expect(ids).toContain('method-register-limits');
  });

  it('honours the limit', () => {
    expect(searchKnowledge('rendition', { limit: 2 }).length).toBeLessThanOrEqual(2);
  });

  it('returns nothing for a question the corpus does not cover', () => {
    expect(searchKnowledge('what is the weather in Houston tomorrow')).toEqual([]);
  });

  it('returns nothing for an empty or stopword-only query', () => {
    expect(searchKnowledge('   ')).toEqual([]);
    expect(searchKnowledge('what is the')).toEqual([]);
  });

  it('reports which terms matched', () => {
    const [hit] = searchKnowledge('freeport inventory 175 days');
    expect(hit?.article.id).toBe('exemptions-freeport-and-allocation');
    expect(hit?.matched).toContain('freeport');
  });
});

describe('getArticle and listArticles', () => {
  it('reads an article by id', () => {
    expect(getArticle('deadlines-season')?.title).toContain('calendar');
    expect(getArticle('no-such-article')).toBeNull();
  });

  it('lists the whole corpus when no topic is given', () => {
    expect(listArticles()).toHaveLength(KNOWLEDGE.length);
  });

  it('lists the method articles under their own topic', () => {
    const method = listArticles(['method']);
    expect(method.length).toBe(8);
    for (const article of method) expect(article.topics).toContain('method');
  });

  it('filters by topic', () => {
    const protest = listArticles(['protest']);
    expect(protest.length).toBeGreaterThan(0);
    for (const article of protest) expect(article.topics).toContain('protest');
  });

  it('filters by jurisdiction, keeping the state-agnostic articles', () => {
    const florida = listArticles(undefined, ['fl']);
    expect(florida.length).toBeGreaterThan(0);
    for (const article of florida) expect(article.jurisdiction ?? 'fl').toBe('fl');
    expect(florida.map((article) => article.id)).toContain('product-two-wings');
    expect(florida.map((article) => article.id)).not.toContain('deadlines-season');
  });
});

describe('renderKnowledge', () => {
  it('renders nothing for no hits', () => {
    expect(renderKnowledge([])).toBe('');
  });

  it('leads each article with its id and authority', () => {
    const rendered = renderKnowledge(searchKnowledge('rendition penalty waiver', { limit: 1 }));
    expect(rendered).toMatch(/^\[penalties-late-and-fraudulent\]/);
    expect(rendered).toContain('Authority: Tax Code 22.28');
    expect(rendered).toContain('State: Texas');
  });

  it('names the state on a Florida article', () => {
    const rendered = renderKnowledge(
      searchKnowledge('tangible personal property tax return', { jurisdictions: ['fl'], limit: 1 }),
    );
    expect(rendered).toContain('State: Florida');
  });

  it('says plainly when an article rests on no statute', () => {
    const hits = searchKnowledge('workspace and market navigation', { limit: 1 });
    const rendered = renderKnowledge(hits);
    if (hits[0]?.article.authority.length === 0) {
      expect(rendered).toContain('not what a state requires');
      expect(rendered).toContain('applies regardless of state');
    }
  });
});
