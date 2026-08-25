# Evaluation baseline

Reproduce with `npm run eval`.

## Current — 2026-08-25, four-document corpus

Corpus: 4 documents, 17 chunks (`src/rag/eval/__corpus__`).

| metric | value |
| --- | --- |
| retrieval questions | 13 |
| mean recall@5 | 1.000 |
| **mean reciprocal rank** | **0.801** |
| **mean nDCG@5** | **0.851** |
| answered and grounded | 13/13 |
| refusals correct | 3/3 |

    PASS  paraphrase-assistance-dog        recall@5=1.00 mrr=1.00 ndcg=1.00
    PASS  paraphrase-quiet-hours           recall@5=1.00 mrr=0.33 ndcg=0.50
    PASS  natural-language-lexical         recall@5=1.00 mrr=1.00 ndcg=1.00
    PASS  exact-token                      recall@5=1.00 mrr=1.00 ndcg=1.00
    PASS  figure-lookup-deposit            recall@5=1.00 mrr=1.00 ndcg=1.00
    PASS  confusable-notice-tenancy        recall@5=1.00 mrr=0.50 ndcg=0.63
    PASS  confusable-notice-employment     recall@5=1.00 mrr=1.00 ndcg=1.00
    PASS  confusable-excess-not-deposit    recall@5=1.00 mrr=1.00 ndcg=1.00
    PASS  confusable-flood                 recall@5=1.00 mrr=1.00 ndcg=1.00
    PASS  conditional-taxi                 recall@5=1.00 mrr=1.00 ndcg=1.00
    PASS  figure-lookup-broadband          recall@5=1.00 mrr=0.25 ndcg=0.43
    PASS  carry-over-leave                 recall@5=1.00 mrr=1.00 ndcg=1.00
    PASS  exclusion-lookup                 recall@5=1.00 mrr=0.33 ndcg=0.50
    PASS  refusal-absent-topic             refused
    PASS  refusal-plausible-but-unstated   refused
    PASS  refusal-wrong-document-plausible refused

## Recall@5 is still not the number to watch

At 17 chunks the top five is 29% of the corpus, so recall stays saturated.
It has to grow by an order of magnitude before recall discriminates anything.

**Reciprocal rank and nDCG are the live metrics**, and moving from one document
to four made them useful: 0.900 to 0.801 and 0.926 to 0.851. Nothing regressed
— distractors simply exist now, which is what a real corpus looks like. Three
questions carry all of the loss:

| question | first relevant hit |
| --- | --- |
| `figure-lookup-broadband` | rank 4 |
| `paraphrase-quiet-hours` | rank 3 |
| `exclusion-lookup` | rank 3 |

That is the headroom any reranking experiment has to beat. A lever that cannot
move these three is not earning its latency.

## What the confusables proved

`notice period` is a heading in both the lease and the handbook; `excess` and
`deposit` are both refundable-sounding sums in different documents; flood
appears twice. All four confusable questions retrieved the right source, and
`refusal-wrong-document-plausible` — asking for the excess on a broadband
contract, where the word exists in the corpus but not in that document —
correctly refused rather than answering from the insurance policy.

That last one is the failure mode that most resembles success, and it is the
strongest evidence so far that the heading breadcrumb is doing real work.

## History

| date | corpus | change under test | recall@5 | MRR | nDCG@5 | grounded | refusals |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-25 | 1 doc, 4 chunks | first baseline | 1.000 | 0.900 | 0.926 | 5/5 | 2/2 |
| 2026-08-25 | 1 doc, 4 chunks | page provenance | 1.000 | 0.900 | 0.926 | 5/5 | 2/2 |
| 2026-08-25 | 4 docs, 17 chunks | corpus grown, 16 questions | 1.000 | 0.801 | 0.851 | 13/13 | 3/3 |
