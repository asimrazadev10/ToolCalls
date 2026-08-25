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

## Reranking — measured, not assumed

`RERANK=1 npm run eval` reorders the fused candidates with a listwise Gemini
call before answering. Against the same corpus and questions:

| | recall@5 | MRR | nDCG@5 | grounded | refusals |
| --- | --- | --- | --- | --- | --- |
| fused only | 1.000 | 0.801 | 0.851 | 13/13 | 3/3 |
| **with reranking** | 1.000 | **0.904** | **0.928** | 13/13 | 3/3 |

It moved two of the three questions it was supposed to:

| question | before | after |
| --- | --- | --- |
| `paraphrase-quiet-hours` | rank 3 | rank 1 |
| `exclusion-lookup` | rank 3 | rank 1 |
| `figure-lookup-broadband` | rank 4 | rank 4 — unchanged |

Nothing regressed: refusals stayed 3/3 and every answer stayed grounded.

### Read the gain narrowly

The entire +0.103 MRR is those two questions moving from 0.33 to 1.00. Thirteen
questions over seventeen chunks is a small sample, and one flip either way
moves the mean by 0.05. The direction is right and the mechanism is understood,
but this is not yet evidence that would survive a larger corpus unchanged.

### What could not be established

`figure-lookup-broadband` is the interesting failure. The fused ranking puts
three irrelevant chunks above the right one, and all three match on the word
**week** — "four weeks notice", "three days each week", "every day of the
week". That is the cost of OR-ing the lexical query: a common word drags in
unrelated documents. It is the same trade that revived the arm in the first
place, seen from the other side.

Given that, the reranker should have fixed it, and in isolation it does — asked
directly, it puts the outages passage first out of five. So during the
evaluation it either failed silently or degraded with seventeen candidates
rather than five. The reranker swallows its own failures **by design**, so that
a reranker cannot break retrieval; the same property hides quota errors.

An instrumented re-run counting those failures could not complete: it stalled
against the rate limit partway through. That stall is itself the finding —
thirteen questions at three model calls each does not fit comfortably in
fifteen requests a minute, which is exactly the confound worth knowing about.

**Recommendation: keep reranking behind the flag, default off**, until the
corpus is large enough for the gain to mean something and the failure rate is
actually counted. The measured improvement is real but resting on two
questions, and enabling it doubles model calls per query on a budget that has
already proven too tight to measure it.

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
| 2026-08-25 | 4 docs, 17 chunks | listwise reranking (RERANK=1) | 1.000 | 0.904 | 0.928 | 13/13 | 3/3 |
