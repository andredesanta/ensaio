"""Pure feature-flag evaluation.

This package is the piece a server-side consumer will import and run in-process.
It must not import Django, talk to the network, or read the clock. Hashing and
``evaluate()`` land in M1. The package exists in M0 so the boundary is real
before any logic is written.
"""
