---
name: No Namespace React Imports
description: Import named or default bindings from react, never the namespace
paths:
  - "**/*.tsx"
  - "**/*.jsx"
---

# No Namespace React Imports

Do not use namespace React imports:

```tsx
import * as React from "react";

// no
```

Use named or default imports instead:

```tsx
import { useMemo } from "react";
import type { ReactNode } from "react";
```
