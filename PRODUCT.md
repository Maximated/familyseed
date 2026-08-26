# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People researching and maintaining their family history, ranging from a
single self-hoster tracking their own ancestry to relatives they invite
into a shared tree, up to unrelated genealogy enthusiasts who self-host
their own instance for their own families. Not assumed to be technical —
tree members invited by an owner are often non-technical family members
who just want to browse and add relatives, not manage software.

## Product Purpose

FamilySeed is a self-hosted family-tree application: build, browse, and
maintain genealogical trees (individuals, unions/marriages, parent-child
relationships, lineages) with an interactive visual tree as the primary
surface, plus supporting tools (search, statistics, media, GEDCOM/CSV
import-export, duplicate detection and merging, relationship lookup,
sharing with role-based access, trash/restore). Success means a family's
history is easy to explore and keep accurate over time, by people who
range from genealogy hobbyists to non-technical relatives just looking
things up.

## Positioning

Self-hosted and private (a family's data lives on their own server, not
a third-party service), with a genuinely cared-for visual tree — the
rendering, union/marriage lines, and card layout have had significant
dedicated design and bug-fixing attention, since the tree is the
product's emotional center, not just a data view. Positioned as simpler
and more approachable than professional genealogy software (e.g.
Gramps), which is powerful but arid for non-technical family members.

## Operating Context

- Multi-tree, multi-user: a user can own or be invited into several
  trees, with per-tree roles (owner/editor/viewer) and invite links.
- The tree view (family-chart-based) is the primary screen: browsing,
  selecting a person opens a detail "ficha" with tabs (info, relations,
  statistics, photos, documents); editing happens through modal forms.
- Import/export: GEDCOM and CSV import/export, for moving data in and
  out of other genealogy tools.
- Data integrity tools: duplicate-person detection with a merge-review
  flow, a trash/restore system for soft-deleted people, a relationship
  wizard (how are X and Y related).
- Lineages: user-defined, color-coded groupings of individuals (e.g. by
  surname branch) used for navigation and highlighting in the tree.
- Per-person and whole-tree statistics, and exportable tree reports
  (image/PDF).
- Installable as a PWA; localized (Spanish, English, Polish).
- Auth via email/password or Google OAuth.
- Deployment: self-hosted via Docker Compose (a published image plus a
  MariaDB container), aimed at someone comfortable running `docker
  compose up`, not a managed SaaS signup.

## Capabilities and Constraints

- Frontend: React + Vite. Backend: Fastify + Prisma + MariaDB.
- The interactive tree is built on the `family-chart` library, extensively
  patched/wrapped by this app's own code (custom union-line rendering,
  level-navigation, lineage highlighting, safe-depth guards) — redesign
  work touching the tree must go through this app's own rendering layer,
  not assume vanilla `family-chart` output.
- Existing light/dark theme toggle already exists app-wide, with defined
  CSS custom-property tokens for both.

## Brand Commitments

Only the existing color palette (forest green, amber, warm cream/dark
graphite surfaces, male/female/other pastel tints) is a fixed constraint
for the current redesign. Name, typography, iconography, and every other
visual element are open to change if it serves the new direction.

## Product Principles

- Self-hosted and private by default — no design decision should imply
  or require a third-party service dependency.
- The tree itself is the emotional center of the product — visual care
  and correctness there outrank polish elsewhere.
- Approachable over powerful — a non-technical invited relative should
  be able to use it without training, even though power users (genealogy
  hobbyists) are also a real audience.
- Built for a range of technical comfort — from the self-hoster running
  Docker to a relative who just clicks a shared link.
