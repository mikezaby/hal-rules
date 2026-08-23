---
name: No Nested Ternaries
description: A ternary whose branch is another ternary becomes guard clauses
paths:
  - "**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte}"
---

# No Nested Ternaries

One ternary is fine. A ternary whose branch is another ternary is not.

Write a function with guard clauses instead, so each condition reads on its own
line and nobody has to match `?` to `:` across five levels of indent.

```js
// not this
const size = isCategory ? "small" : isPoster ? "poster" : "landscape";

// this
const size = () => {
  if (isCategory) return "small";
  if (isPoster) return "poster";
  return "landscape";
};
```

A flat lookup map is better still when the branches key off one value.
