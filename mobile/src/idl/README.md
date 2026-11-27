Program ID: `4LH7ikNGVVNaemB7eaLGUMbwSBHHqA2hKXTdrfhgD6nh`. The feature-complete generated IDL was announced on 2026-11-26. A devnet deployment has not been announced.

`argus.json` and the camelCase type helper `argus.ts` are exact copies of `app/src/idl/argus.*`. Windows cannot traverse the repository's `target/` link. The client tests check both copies against that source. All account coding, instruction data, discriminators and account metas use Anchor's generated-IDL client; PDA seed prefixes also come from IDL metadata.

The initially disclosed TrustedAddress gap was corrected in the upstream JSON and TS helper during integration. Both corrected files are now vendored: Vault, Withdrawal, Proposal and TrustedAddress all have IDL-based decoders. Trusted withdrawal selects the record using the destination token account's authority.

After each announced IDL update, replace both files together and run the mobile checks. Verify the announced deployment address before enabling live actions. Cancel/freeze remain direct MWA-to-program actions, disabled outside the local demo until deployment. Sentinel never signs app transactions.
