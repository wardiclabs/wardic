# Security

## Supported versions

The latest release of each `@wardic/*` package gets security fixes: the latest `1.x` of `@wardic/core`, `@wardic/dom` and `@wardic/test`, and the latest `2.x` of `@wardic/solid`, both its bindings: Solid 2's at the root, and Solid 1's at `@wardic/solid/v1` until the major that removes it.

## Reporting a vulnerability

Please don't open a public issue for it. Report it privately:

- **Through GitHub:** the repository's **Security** tab → **Report a vulnerability** (private vulnerability reporting). This is preferred: the report, the fix and the advisory stay in one place.
- **By email:** security@wardic.dev.

Say what's affected (the package and its version, the binding, the browser or runtime), how to reproduce it, and what it lets someone do.

Wardic is maintained by one person for now, so there's no set time for an answer: a report is acknowledged as soon as it can be, you're kept told as it's fixed, and you're credited in the advisory unless you'd rather not be.

The storefront demos (`examples/`, served at wardic.dev's subdomains) are examples, not published code; a problem in them is still worth reporting the same way.
