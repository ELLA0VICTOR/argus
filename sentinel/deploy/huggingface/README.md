---
title: Argus Sentinel
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
short_description: The AI guardian service behind the Argus live demo
---

# Argus Sentinel

The AI guardian service for [Argus](https://github.com/ELLA0VICTOR/argus), a self-custodial Solana vault. It runs the live "steal this wallet" demo on devnet: it scores withdrawals, calls the owner through the Argus voice agent, and cancels and freezes on-chain with a key that can only cancel or freeze.

Health check: `/v1/health`. Source: [`sentinel/`](https://github.com/ELLA0VICTOR/argus/tree/main/sentinel).
