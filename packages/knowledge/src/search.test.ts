import { describe, expect, it } from 'vitest';
import { KNOWLEDGE } from './corpus/index.js';
import { KNOWLEDGE_TOPICS } from './types.js';
import { getArticle, listArticles, renderKnowledge, searchKnowledge } from './search.js';

/**
 * Two kinds of test here, and the first kind matters more.
 *
 * The integrity tests hold the corpus to its own contract — unique ids, real
 * topics, a `related` link that points at something, an authority line on
 * every article that speaks in the voice of Texas law. A broken cross-link or
 * an invented statute cite would otherwise reach a client through an answer,
 * and nothing else in the build would catch it.
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
      const isProduct = article.topics.includes('product');
      if (isProduct) continue;
      expect(article.authority.length, article.id).toBeGreaterThan(0);
    }
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

  it('filters by topic', () => {
    const protest = listArticles(['protest']);
    expect(protest.length).toBeGreaterThan(0);
    for (const article of protest) expect(article.topics).toContain('protest');
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
  });

  it('says plainly when an article rests on no statute', () => {
    const hits = searchKnowledge('workspace and market navigation', { limit: 1 });
    const rendered = renderKnowledge(hits);
    if (hits[0]?.article.authority.length === 0) {
      expect(rendered).toContain('not what Texas requires');
    }
  });
});
