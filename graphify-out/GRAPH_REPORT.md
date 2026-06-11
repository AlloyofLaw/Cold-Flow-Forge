# Graph Report - .  (2026-06-11)

## Corpus Check
- Corpus is ~16,430 words - fits in a single context window. You may not need a graph.

## Summary
- 32 nodes · 55 edges · 5 communities (4 shown, 1 thin omitted)
- Extraction: 69% EXTRACTED · 29% INFERRED · 2% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.89)
- Token cost: 78,693 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Codex Skill Integration|Codex Skill Integration]]
- [[_COMMUNITY_Always-On Hook Setup|Always-On Hook Setup]]
- [[_COMMUNITY_Extraction & Query Pipeline|Extraction & Query Pipeline]]
- [[_COMMUNITY_Incremental Update Flow|Incremental Update Flow]]
- [[_COMMUNITY_AudioVideo Transcription|Audio/Video Transcription]]

## God Nodes (most connected - your core abstractions)
1. `graphify Skill (Claude version)` - 16 edges
2. `graphify Skill (Codex version)` - 10 edges
3. `Claude CLAUDE.md graphify Integration` - 6 edges
4. `graphify Query/Path/Explain Reference` - 5 edges
5. `graphify-out/graph.json (persistent knowledge graph)` - 5 edges
6. `Semantic Extraction Subagent Pipeline` - 5 edges
7. `graphify Commit Hook & CLAUDE.md Integration Reference` - 4 edges
8. `Claude PreToolUse Hooks (graphify enforcement)` - 3 edges
9. `Root CLAUDE.md graphify Integration` - 3 edges
10. `graphify Extraction Subagent Spec` - 3 edges

## Surprising Connections (you probably didn't know these)
- `Codex PreToolUse Hook (graphify hook-check)` --conceptually_related_to--> `graphify-out/graph.json (persistent knowledge graph)`  [INFERRED]
  .codex/hooks.json → .claude/skills/graphify/SKILL.md
- `AGENTS.md graphify Trigger` --semantically_similar_to--> `Claude CLAUDE.md graphify Integration`  [INFERRED] [semantically similar]
  AGENTS.md → .claude/CLAUDE.md
- `graphify Skill (Codex version)` --semantically_similar_to--> `graphify Skill (Claude version)`  [INFERRED] [semantically similar]
  .codex/skills/graphify/SKILL.md → .claude/skills/graphify/SKILL.md
- `graphify Commit Hook Reference (Codex)` --semantically_similar_to--> `graphify Commit Hook & CLAUDE.md Integration Reference`  [INFERRED] [semantically similar]
  .codex/skills/graphify/references/hooks.md → .claude/skills/graphify/references/hooks.md
- `Codex PreToolUse Hook (graphify hook-check)` --semantically_similar_to--> `Claude PreToolUse Hooks (graphify enforcement)`  [INFERRED] [semantically similar]
  .codex/hooks.json → .claude/settings.json

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **graphify Pipeline Stages (Detect -> AST/Semantic Extract -> Build/Cluster -> Label -> Export)** — graphify_skill_md, concept_ast_extraction, concept_semantic_extraction_subagent, concept_graphify_out_graph_json, concept_graph_report_md [EXTRACTED 0.90]
- **Dual Claude/Codex Agent Integration for graphify** — claude_settings_pretooluse_hooks, codex_hooks_pretooluse_graphify_hookcheck, graphify_skill_md, graphify_skill_md_codex, claude_claude_md_graphify_section, claude_md_graphify_section, agents_md_graphify_trigger [INFERRED 0.85]
- **graphify Query/Path/Explain Navigation Flows** — references_query, concept_query_expansion_step0, concept_graphify_out_graph_json, concept_graph_report_md [EXTRACTED 0.85]

## Communities (5 total, 1 thin omitted)

### Community 0 - "Codex Skill Integration"
Cohesion: 0.20
Nodes (10): Claude Agent Tool Parallel Subagent Dispatch, Codex spawn_agent/wait_agent/close_agent Multi-Agent Dispatch, graphify Skill (Codex version), graphify add/--watch Reference, graphify add/--watch Reference (Codex), graphify Exports Reference (wiki, neo4j, svg, graphml, mcp, benchmark), graphify Exports Reference (Codex), graphify GitHub Clone & Cross-Repo Merge Reference (+2 more)

### Community 1 - "Always-On Hook Setup"
Cohesion: 0.39
Nodes (9): AGENTS.md graphify Trigger, Claude CLAUDE.md graphify Integration, Root CLAUDE.md graphify Integration, Claude PreToolUse Hooks (graphify enforcement), Codex PreToolUse Hook (graphify hook-check), GRAPH_REPORT.md (audit report), graphify-out/graph.json (persistent knowledge graph), graphify Skill (Claude version) (+1 more)

### Community 2 - "Extraction & Query Pipeline"
Cohesion: 0.47
Nodes (6): Constrained Query Expansion (vocab-matching before traversal), Semantic Extraction Subagent Pipeline, graphify Extraction Subagent Spec, graphify Extraction Subagent Spec (Codex, compact), graphify Query/Path/Explain Reference, graphify Query/Path/Explain Reference (Codex, CLI+NetworkX fallback)

### Community 3 - "Incremental Update Flow"
Cohesion: 0.40
Nodes (5): AST Structural Extraction (code files), Incremental Update (--update / --cluster-only), Post-Commit Auto-Rebuild Hook, graphify Incremental Update / Cluster-Only Reference, graphify Update / Cluster-Only Reference (Codex)

## Ambiguous Edges - Review These
- `graphify Query/Path/Explain Reference (Codex, CLI+NetworkX fallback)` → `Constrained Query Expansion (vocab-matching before traversal)`  [AMBIGUOUS]
  .codex/skills/graphify/references/query.md · relation: conceptually_related_to

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `graphify Query/Path/Explain Reference (Codex, CLI+NetworkX fallback)` and `Constrained Query Expansion (vocab-matching before traversal)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `graphify Skill (Claude version)` connect `Always-On Hook Setup` to `Codex Skill Integration`, `Extraction & Query Pipeline`, `Incremental Update Flow`, `Audio/Video Transcription`?**
  _High betweenness centrality (0.628) - this node is a cross-community bridge._
- **Why does `graphify Skill (Codex version)` connect `Codex Skill Integration` to `Always-On Hook Setup`, `Extraction & Query Pipeline`, `Incremental Update Flow`, `Audio/Video Transcription`?**
  _High betweenness centrality (0.293) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `Claude CLAUDE.md graphify Integration` (e.g. with `AGENTS.md graphify Trigger` and `Root CLAUDE.md graphify Integration`) actually correct?**
  _`Claude CLAUDE.md graphify Integration` has 2 INFERRED edges - model-reasoned connections that need verification._