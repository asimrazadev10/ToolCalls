# Evaluation baseline

Recorded 2026-08-25, against `lease-detailed.pdf` (1 page, 4 chunks).
Reproduce with `npm run eval`.

| metric | value |
| --- | --- |
| retrieval questions | 5 |
| mean recall@5 | 1.000 |
| mean reciprocal rank | 0.900 |
| mean nDCG@5 | 0.926 |
| answered and grounded | 5/5 |
| refusals correct | 2/2 |

Per question:

    PASS  paraphrase-assistance-dog        recall@5=1.00 mrr=1.00 ndcg=1.00 answered
    PASS  paraphrase-quiet-hours           recall@5=1.00 mrr=0.50 ndcg=0.63 answered
    PASS  natural-language-lexical         recall@5=1.00 mrr=1.00 ndcg=1.00 answered
    PASS  exact-token                      recall@5=1.00 mrr=1.00 ndcg=1.00 answered
    PASS  figure-lookup                    recall@5=1.00 mrr=1.00 ndcg=1.00 answered
    PASS  refusal-absent-topic             refused
    PASS  refusal-plausible-but-unstated   refused

## Read recall@5 with suspicion at this corpus size

The corpus holds four chunks and recall is measured at five, so every relevant
chunk is inside the window by construction. **Mean recall@5 of 1.000 is close
to arithmetically unavoidable here and should not be quoted as a result.**

The informative numbers are reciprocal rank and nDCG, which measure ordering
rather than membership, and they already show something: on
`paraphrase-quiet-hours` the right chunk came back at rank 2, not rank 1. That
is a real if minor ranking weakness, and the only reason it is visible is that
MRR does not round it away.

Recall becomes meaningful once the corpus is large enough that the top five is
a genuine selection — several documents and a few hundred chunks. Growing the
corpus is the next improvement to this harness, ahead of adding questions.

## What each question is for

The set is deliberately not seven versions of the same question. Each targets a
capability that has already broken, or plausibly could:

- **paraphrase-\*** — dense retrieval, where question and document share almost
  no vocabulary.
- **natural-language-lexical** — the exact case where the lexical arm was
  silently dead, because `websearch_to_tsquery` ANDs every term and a
  conversational question therefore matched nothing.
- **exact-token** — the rare token dense retrieval blurs.
- **figure-lookup** — an answer that is a number and a period, both of which
  must survive chunking and be quoted exactly.
- **refusal-\*** — the failure this system most needs to avoid. The second is
  the harder one: a lease plausibly answers "how many people may live here",
  so related passages retrieve and the model must still decline.
