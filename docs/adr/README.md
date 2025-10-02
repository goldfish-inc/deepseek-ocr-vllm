# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the Oceanid infrastructure project.

## What is an ADR?

An Architecture Decision Record captures an important architectural decision made along with its context and consequences.

## ADR Format

We use a lightweight format:

- **Title**: ADR-XXXX: Brief description
- **Date**: When the decision was made
- **Status**: Proposed/Accepted/Deprecated/Superseded
- **Context**: Why we need to make this decision
- **Decision**: What we decided
- **Consequences**: What happens as a result

## Current ADRs

- [0001-K3s-cluster-architecture.md](0001-k3s-cluster-architecture.md) - K3s cluster choice

## Creating New ADRs

1. Use the next sequential number (0002, 0003, etc.)
2. Follow the format in existing ADRs
3. Update this README with the new entry
4. Commit with message: `docs(adr): add ADR-XXXX for [decision]`

## References

- [Architectural Decision Records](https://adr.github.io/)
- [MADR Format](https://adr.github.io/madr/)
