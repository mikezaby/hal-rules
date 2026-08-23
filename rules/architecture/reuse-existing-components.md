---
name: Reuse What Already Exists
description: Read the component library before building any control
---

# Reuse What Already Exists

**Read the shared component directory before building any control, and use what
is there.** Re-implementing something the design system already ships is the most
common kind of slop: it duplicates the styling, misses the focus, disabled, hover
and loading states the component already handles, and drifts from the design the
moment either side changes.

A hand-rolled native element is right only when the thing genuinely is not one of
the existing components. "Close enough, I'll override the classes" is not that
case, and overriding a component's base utilities from the call site often does
not work anyway, since conflicting utilities resolve by stylesheet order.

When the design calls for a component the library should have but doesn't, say
so rather than hand-rolling it. Adding the missing one is a deliberate decision.
