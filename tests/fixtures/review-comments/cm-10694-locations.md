# Review comment location fixture

`cm-10694-locations.xml` was captured on Windows with Unity VCS `11.0.16.10694` by running `cm find changereviewcomment "where reviewid=<owned-review-id>" --xml --encoding=utf-8` against a temporary synthetic changeset review. The five comments were review-wide, single line (`--line=1`), range (`--line=1-2`), whole-file (revision without a line), and custom (`--location=image:120,80&x=y`). The temporary review and its comments were removed after capture.

Owner, IDs, GUIDs, dates, and the file path were replaced with synthetic values; line endings were normalized to LF. The `LINE`, `LOCATION`, and XML entity encoding are unchanged.
