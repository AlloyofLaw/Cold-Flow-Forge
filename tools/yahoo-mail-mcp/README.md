# yahoo-mail-mcp (vendored, patched)

Audited and security-patched copy of
[jtokib/yahoo-mail-mcp-server](https://github.com/jtokib/yahoo-mail-mcp-server),
pinned to commit `c1ced5a4dfd3cdbf1130225a2c8799323adbff52` (v3.0.0).

| Document | What it covers |
|---|---|
| **[INSTALL.md](INSTALL.md)** | Start here. Claude Desktop setup, local stdio mode. |
| **[SECURITY-AUDIT.md](SECURITY-AUDIT.md)** | Full audit: malware review, 11 defects found, what was fixed, residual risks. |
| `security-patches.diff` | The exact changes made to upstream `server.js` and `render.yaml`. |
| `README.upstream.md` | The original upstream README, unmodified, for reference. |

**Short version:** upstream contains no malicious code — no exfiltration, no
code-execution primitives, no install hooks, all dependencies from npm. It did
have a fail-open authentication path that would have exposed the whole mailbox
on any public deployment, plus several weaker OAuth defects and 13 dependency
advisories. All are fixed here; `npm audit` reports 0 vulnerabilities.

Running this locally over stdio is the intended and safe configuration.

## Why vendored rather than a submodule

The upstream repo is a single-maintainer project with no review process. Pinning
a reviewed copy means an upstream change cannot alter what runs against a live
mailbox without someone re-reading the diff first.

To take an upstream update: diff upstream against
`c1ced5a4dfd3cdbf1130225a2c8799323adbff52`, re-run the checks in
`SECURITY-AUDIT.md` § 4, and re-apply `security-patches.diff`.
