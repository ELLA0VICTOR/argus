Program ID: `4LH7ikNGVVNaemB7eaLGUMbwSBHHqA2hKXTdrfhgD6nh`, live on devnet as of 2026-11-27, deployment slot 526836877. Downloaded bytecode SHA-256 matches HANDOFF: `831417e4dcbfd59cf82753479bf22101fca1614a41953d6fb3e8992662da72f9`.

`argus.json` and the camelCase type helper `argus.ts` are exact copies of `app/src/idl/argus.*`. Windows cannot traverse the repository's `target/` link. The client tests check both copies against that source. All account coding, instruction data, discriminators and account metas use Anchor's generated-IDL client; PDA seed prefixes also come from IDL metadata.

The initially disclosed TrustedAddress gap was corrected in the upstream JSON and TS helper during integration. Both corrected files are now vendored: Vault, Withdrawal, Proposal and TrustedAddress all have IDL-based decoders. Trusted withdrawal selects the record using the destination token account's authority.

The refreshed deployed IDL has 14 instructions, including `close_proposal`, and 34 errors (6000–6033). All builders use Anchor's strict account metadata. The seven-day proposal TTL applies only before threshold; dead-proposal cleanup refunds the stored payer.

After each announced IDL update, replace both files together and run the mobile checks. Live devnet actions are enabled through MWA; the transaction pipeline checks devnet genesis, the authorized wallet and the returned signed message. Sentinel never signs app transactions. Sample/demo screens retain explicit simulations.
