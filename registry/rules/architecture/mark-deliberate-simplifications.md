---
name: Mark Deliberate Simplifications
description: A knowing shortcut carries a comment naming its ceiling and upgrade path
---

# Mark Deliberate Simplifications

A shortcut taken knowingly gets a `{{marker}}` comment naming what it gives up
and what would replace it:

```js
// {{marker}} global lock; per-account locks if throughput matters
```

These are intentional. Read the comment before "fixing" one.

Simple reads as intent when it is marked, and as ignorance when it is not.
