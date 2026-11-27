/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/argus.json`.
 */
export type Argus = {
  "address": "4LH7ikNGVVNaemB7eaLGUMbwSBHHqA2hKXTdrfhgD6nh",
  "metadata": {
    "name": "argus",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "approve",
      "docs": [
        "A guardian approves. Reaching the threshold sets `eta`."
      ],
      "discriminator": [
        69,
        74,
        217,
        36,
        115,
        117,
        97,
        76
      ],
      "accounts": [
        {
          "name": "guardian",
          "signer": true
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vaultId",
                "account": "vault"
              }
            ]
          },
          "relations": [
            "proposal"
          ]
        },
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "proposal.id",
                "account": "proposal"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "cancelWithdrawal",
      "docs": [
        "Owner, any guardian or the AI cancels a pending withdrawal. Allowed while frozen."
      ],
      "discriminator": [
        183,
        104,
        181,
        250,
        28,
        128,
        210,
        70
      ],
      "accounts": [
        {
          "name": "canceller",
          "signer": true
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vaultId",
                "account": "vault"
              }
            ]
          },
          "relations": [
            "withdrawal"
          ]
        },
        {
          "name": "withdrawal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "withdrawal.id",
                "account": "withdrawal"
              }
            ]
          }
        },
        {
          "name": "rentPayer",
          "writable": true,
          "relations": [
            "withdrawal"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "closeProposal",
      "docs": [
        "Anyone closes a dead (stale or expired) proposal and refunds its rent."
      ],
      "discriminator": [
        213,
        178,
        139,
        19,
        50,
        191,
        82,
        245
      ],
      "accounts": [
        {
          "name": "closer",
          "signer": true
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vaultId",
                "account": "vault"
              }
            ]
          },
          "relations": [
            "proposal"
          ]
        },
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "proposal.id",
                "account": "proposal"
              }
            ]
          }
        },
        {
          "name": "rentPayer",
          "writable": true,
          "relations": [
            "proposal"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "deposit",
      "docs": [
        "Anyone moves tokens into the vault. Allowed while frozen."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "depositor",
          "signer": true
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vaultId",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "vaultToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "from",
          "docs": [
            "Source account. The token program enforces that `depositor` is its owner or delegate."
          ],
          "writable": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "emergencySweep",
      "docs": [
        "Any guardian sweeps the whole balance to the safe address. Allowed while frozen."
      ],
      "discriminator": [
        172,
        124,
        148,
        179,
        216,
        193,
        206,
        41
      ],
      "accounts": [
        {
          "name": "guardian",
          "docs": [
            "Pays for the safe ATA if it doesn't exist yet."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vaultId",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "vaultToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "safeWallet"
        },
        {
          "name": "safeToken",
          "docs": [
            "`safe_address` (INV-9, audit A6). It is created idempotently in the handler,",
            "so a missing safe ATA can never block a rescue. The ATA program verifies",
            "owner and mint for an existing account."
          ],
          "writable": true
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "freeze",
          "type": "bool"
        }
      ]
    },
    {
      "name": "executeProposal",
      "docs": [
        "Anyone executes a proposal past its `eta`."
      ],
      "discriminator": [
        186,
        60,
        116,
        133,
        108,
        128,
        111,
        28
      ],
      "accounts": [
        {
          "name": "executor",
          "docs": [
            "Pays for a new TrustedAddress (AddTrusted) and gets RemoveTrusted refunds."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vaultId",
                "account": "vault"
              }
            ]
          },
          "relations": [
            "proposal"
          ]
        },
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "proposal.id",
                "account": "proposal"
              }
            ]
          }
        },
        {
          "name": "rentPayer",
          "docs": [
            "`dup`: the proposer usually executes their own proposal, so this is often",
            "the same account as `executor` (audit F-1). It only ever receives lamports,",
            "so aliasing is safe."
          ],
          "writable": true,
          "relations": [
            "proposal"
          ]
        },
        {
          "name": "trusted",
          "docs": [
            "checks that it's exactly PDA `[\"trusted\", vault, action.trusted_wallet()]`."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "executeWithdrawal",
      "docs": [
        "Anyone executes a matured withdrawal with a matching owner epoch."
      ],
      "discriminator": [
        113,
        121,
        203,
        232,
        137,
        139,
        248,
        249
      ],
      "accounts": [
        {
          "name": "cranker",
          "signer": true
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vaultId",
                "account": "vault"
              }
            ]
          },
          "relations": [
            "withdrawal"
          ]
        },
        {
          "name": "withdrawal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "withdrawal.id",
                "account": "withdrawal"
              }
            ]
          }
        },
        {
          "name": "rentPayer",
          "writable": true,
          "relations": [
            "withdrawal"
          ]
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "vaultToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "destination",
          "docs": [
            "Pinned by `has_one = destination`. The mint is re-checked here (INV-9)."
          ],
          "writable": true,
          "relations": [
            "withdrawal"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "freeze",
      "docs": [
        "Owner, any guardian or the AI freezes the vault."
      ],
      "discriminator": [
        255,
        91,
        207,
        84,
        251,
        194,
        254,
        63
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vaultId",
                "account": "vault"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "initializeVault",
      "docs": [
        "Creates a vault and its token account. The creator becomes the owner."
      ],
      "discriminator": [
        48,
        191,
        163,
        44,
        71,
        129,
        63,
        164
      ],
      "accounts": [
        {
          "name": "creator",
          "docs": [
            "Pays rent and becomes the first owner."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "vaultId"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "v1: classic SPL Token mints only (PROGRAM-SPEC §1, Token-2022 extensions break INV-1).",
            "Together with the `token_program` address check, every Token-2022 combination",
            "fails with `UnsupportedMint` (CR-INIT-2)."
          ]
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Must come before `vault_token`. Anchor checks constraints in field order,",
            "so a Token-2022 program fails here with `UnsupportedMint` rather than as a",
            "generic address mismatch on the ATA (CR-INIT-2)."
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "vaultToken",
          "docs": [
            "ATA(vault, mint) for classic SPL Token. It isn't created with `init`,",
            "because anyone can create an ATA permissionlessly, and a third party",
            "pre-creating it would then block the vault forever (CR-INIT-1). The handler",
            "calls ATA `create_idempotent` after every check passes. For an existing",
            "account, the ATA program verifies the owner (vault) and mint."
          ],
          "writable": true
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "vaultId",
          "type": "u64"
        },
        {
          "name": "guardians",
          "type": {
            "vec": "pubkey"
          }
        },
        {
          "name": "threshold",
          "type": "u8"
        },
        {
          "name": "aiGuardian",
          "type": "pubkey"
        },
        {
          "name": "safeAddress",
          "type": "pubkey"
        },
        {
          "name": "delaySeconds",
          "type": "i64"
        },
        {
          "name": "dailyLimit",
          "type": "u64"
        }
      ]
    },
    {
      "name": "propose",
      "docs": [
        "Any guardian proposes a governance action (auto-approves their own bit)."
      ],
      "discriminator": [
        93,
        253,
        82,
        168,
        118,
        33,
        102,
        90
      ],
      "accounts": [
        {
          "name": "guardian",
          "docs": [
            "Pays the Proposal rent and gets it back on execute or veto."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vaultId",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "vault.nextProposalId",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "action",
          "type": {
            "defined": {
              "name": "govAction"
            }
          }
        }
      ]
    },
    {
      "name": "requestWithdrawal",
      "docs": [
        "Owner requests a delayed withdrawal (cancellable until `executes_at`)."
      ],
      "discriminator": [
        251,
        85,
        121,
        205,
        56,
        201,
        12,
        177
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vaultId",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "owner",
          "docs": [
            "Pays the Withdrawal rent and gets it back on execute or cancel."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "vaultToken",
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "destination"
        },
        {
          "name": "withdrawal",
          "docs": [
            "Ids come from the vault counter and are never reused (INV-12, E2)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "vault.nextWithdrawalId",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "veto",
      "docs": [
        "Any guardian vetoes a vetoable proposal (but not their own removal)."
      ],
      "discriminator": [
        190,
        152,
        69,
        226,
        61,
        150,
        107,
        215
      ],
      "accounts": [
        {
          "name": "guardian",
          "signer": true
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vaultId",
                "account": "vault"
              }
            ]
          },
          "relations": [
            "proposal"
          ]
        },
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "proposal.id",
                "account": "proposal"
              }
            ]
          }
        },
        {
          "name": "rentPayer",
          "writable": true,
          "relations": [
            "proposal"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "withdrawInstant",
      "docs": [
        "Owner spends within the rolling 24h allowance."
      ],
      "discriminator": [
        235,
        18,
        178,
        1,
        234,
        131,
        136,
        103
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vaultId",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "owner",
          "docs": [
            "Only the current owner. Guardians and the AI are rejected (INV-5)."
          ],
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "vaultToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "destination",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawTrusted",
      "docs": [
        "Owner sends any amount to an active trusted wallet."
      ],
      "discriminator": [
        238,
        95,
        27,
        239,
        253,
        148,
        245,
        134
      ],
      "accounts": [
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.creator",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vaultId",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "vaultToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "trusted",
          "docs": [
            "It is unchecked so that a missing record returns `NotTrusted`",
            "rather than a generic framework error. The handler verifies the owner and discriminator."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  117,
                  115,
                  116,
                  101,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "destination.owner"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "proposal",
      "discriminator": [
        26,
        94,
        189,
        187,
        116,
        136,
        53,
        33
      ]
    },
    {
      "name": "trustedAddress",
      "discriminator": [
        43,
        160,
        82,
        15,
        130,
        198,
        138,
        147
      ]
    },
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    },
    {
      "name": "withdrawal",
      "discriminator": [
        10,
        45,
        211,
        182,
        129,
        235,
        90,
        82
      ]
    }
  ],
  "events": [
    {
      "name": "deposited",
      "discriminator": [
        111,
        141,
        26,
        45,
        161,
        35,
        100,
        57
      ]
    },
    {
      "name": "frozen",
      "discriminator": [
        115,
        77,
        189,
        83,
        81,
        71,
        245,
        232
      ]
    },
    {
      "name": "instantWithdrawn",
      "discriminator": [
        19,
        59,
        52,
        128,
        171,
        153,
        53,
        137
      ]
    },
    {
      "name": "proposalApproved",
      "discriminator": [
        70,
        49,
        155,
        228,
        157,
        43,
        88,
        49
      ]
    },
    {
      "name": "proposalClosed",
      "discriminator": [
        57,
        90,
        47,
        164,
        105,
        55,
        97,
        27
      ]
    },
    {
      "name": "proposalCreated",
      "discriminator": [
        186,
        8,
        160,
        108,
        81,
        13,
        51,
        206
      ]
    },
    {
      "name": "proposalExecuted",
      "discriminator": [
        92,
        213,
        189,
        201,
        101,
        83,
        111,
        83
      ]
    },
    {
      "name": "proposalVetoed",
      "discriminator": [
        185,
        29,
        77,
        23,
        134,
        251,
        155,
        27
      ]
    },
    {
      "name": "swept",
      "discriminator": [
        254,
        138,
        9,
        198,
        192,
        61,
        165,
        135
      ]
    },
    {
      "name": "trustedWithdrawn",
      "discriminator": [
        25,
        172,
        236,
        113,
        248,
        183,
        225,
        89
      ]
    },
    {
      "name": "vaultInitialized",
      "discriminator": [
        180,
        43,
        207,
        2,
        18,
        71,
        3,
        75
      ]
    },
    {
      "name": "withdrawalCancelled",
      "discriminator": [
        119,
        175,
        207,
        80,
        186,
        237,
        229,
        9
      ]
    },
    {
      "name": "withdrawalExecuted",
      "discriminator": [
        37,
        78,
        199,
        192,
        51,
        68,
        173,
        162
      ]
    },
    {
      "name": "withdrawalRequested",
      "discriminator": [
        75,
        207,
        21,
        12,
        160,
        102,
        150,
        55
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "frozen",
      "msg": "The vault is frozen"
    },
    {
      "code": 6001,
      "name": "notOwner",
      "msg": "Signer is not the vault owner"
    },
    {
      "code": 6002,
      "name": "notGuardian",
      "msg": "Signer is not a guardian of this vault"
    },
    {
      "code": 6003,
      "name": "notAuthorizedRole",
      "msg": "Signer's role is not allowed to perform this action"
    },
    {
      "code": 6004,
      "name": "overDailyLimit",
      "msg": "Amount exceeds the remaining daily allowance"
    },
    {
      "code": 6005,
      "name": "notTrusted",
      "msg": "Destination is not a trusted address"
    },
    {
      "code": 6006,
      "name": "trustedNotActive",
      "msg": "Trusted address is not active yet"
    },
    {
      "code": 6007,
      "name": "tooEarly",
      "msg": "Too early: the delay has not elapsed"
    },
    {
      "code": 6008,
      "name": "staleOwnerEpoch",
      "msg": "Withdrawal was requested by a previous owner key"
    },
    {
      "code": 6009,
      "name": "staleGuardianEpoch",
      "msg": "Proposal was created under a previous guardian set"
    },
    {
      "code": 6010,
      "name": "thresholdNotMet",
      "msg": "Guardian threshold not met"
    },
    {
      "code": 6011,
      "name": "alreadyApproved",
      "msg": "This guardian has already approved"
    },
    {
      "code": 6012,
      "name": "invalidThreshold",
      "msg": "Threshold must be between 1 and the number of guardians"
    },
    {
      "code": 6013,
      "name": "duplicateGuardian",
      "msg": "Duplicate guardian"
    },
    {
      "code": 6014,
      "name": "roleOverlap",
      "msg": "A key cannot hold two roles (owner, guardian, AI guardian)"
    },
    {
      "code": 6015,
      "name": "delayOutOfBounds",
      "msg": "Delay is outside the allowed bounds"
    },
    {
      "code": 6016,
      "name": "notStricter",
      "msg": "Change must be stricter than the current setting"
    },
    {
      "code": 6017,
      "name": "mintMismatch",
      "msg": "Token account mint does not match the vault mint"
    },
    {
      "code": 6018,
      "name": "insufficientFunds",
      "msg": "Insufficient funds in the vault"
    },
    {
      "code": 6019,
      "name": "tooManyTrusted",
      "msg": "Too many trusted addresses"
    },
    {
      "code": 6020,
      "name": "notVetoable",
      "msg": "This proposal cannot be vetoed"
    },
    {
      "code": 6021,
      "name": "cannotVetoOwnRemoval",
      "msg": "A guardian cannot veto their own removal"
    },
    {
      "code": 6022,
      "name": "invalidGuardianCount",
      "msg": "A vault needs between 1 and 5 guardians"
    },
    {
      "code": 6023,
      "name": "invalidGuardian",
      "msg": "Guardian key is invalid"
    },
    {
      "code": 6024,
      "name": "invalidSafeAddress",
      "msg": "Safe address must be set and must not be the owner, the AI guardian or the vault itself"
    },
    {
      "code": 6025,
      "name": "unsupportedMint",
      "msg": "Only classic SPL Token mints are supported in v1"
    },
    {
      "code": 6026,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6027,
      "name": "invalidAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6028,
      "name": "invalidDestination",
      "msg": "Destination cannot be the vault's own token account"
    },
    {
      "code": 6029,
      "name": "alreadyTrusted",
      "msg": "This wallet is already trusted"
    },
    {
      "code": 6030,
      "name": "invalidTrustedWallet",
      "msg": "Trusted wallet is invalid"
    },
    {
      "code": 6031,
      "name": "trustedAccountMismatch",
      "msg": "The trusted-record account passed does not match the proposal"
    },
    {
      "code": 6032,
      "name": "proposalExpired",
      "msg": "Proposal expired before reaching its threshold"
    },
    {
      "code": 6033,
      "name": "proposalStillLive",
      "msg": "Proposal is still live and cannot be closed"
    }
  ],
  "types": [
    {
      "name": "deposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "depositor",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "frozen",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "by",
            "type": "pubkey"
          },
          {
            "name": "byRole",
            "type": {
              "defined": {
                "name": "role"
              }
            }
          }
        ]
      }
    },
    {
      "name": "govAction",
      "docs": [
        "A guardian-threshold change to the vault."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "rotateOwner",
            "fields": [
              {
                "name": "newOwner",
                "type": "pubkey"
              }
            ]
          },
          {
            "name": "unfreeze"
          },
          {
            "name": "removeTrusted",
            "fields": [
              {
                "name": "wallet",
                "type": "pubkey"
              }
            ]
          },
          {
            "name": "tightenLimits",
            "fields": [
              {
                "name": "dailyLimit",
                "type": "u64"
              },
              {
                "name": "delaySeconds",
                "type": "i64"
              }
            ]
          },
          {
            "name": "addTrusted",
            "fields": [
              {
                "name": "wallet",
                "type": "pubkey"
              }
            ]
          },
          {
            "name": "loosenLimits",
            "fields": [
              {
                "name": "dailyLimit",
                "type": "u64"
              },
              {
                "name": "delaySeconds",
                "type": "i64"
              }
            ]
          },
          {
            "name": "setSafeAddress",
            "fields": [
              {
                "name": "wallet",
                "type": "pubkey"
              }
            ]
          },
          {
            "name": "setGuardians",
            "fields": [
              {
                "name": "guardians",
                "type": {
                  "vec": "pubkey"
                }
              },
              {
                "name": "threshold",
                "type": "u8"
              }
            ]
          },
          {
            "name": "setAiGuardian",
            "fields": [
              {
                "name": "key",
                "type": "pubkey"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "instantWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "spentInWindow",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "proposal",
      "docs": [
        "A governance proposal. PDA: `[\"proposal\", vault, id_le]`. Closed on execute or veto."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "action",
            "type": {
              "defined": {
                "name": "govAction"
              }
            }
          },
          {
            "name": "approvals",
            "docs": [
              "Bitmap indexed by guardian slot (INV-8)."
            ],
            "type": "u8"
          },
          {
            "name": "guardianEpoch",
            "docs": [
              "`vault.guardian_epoch` at creation (INV-7)."
            ],
            "type": "u32"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "eta",
            "docs": [
              "0 until the threshold is reached, then `now + timelock`. Set once (INV-3, C7)."
            ],
            "type": "i64"
          },
          {
            "name": "proposer",
            "type": "pubkey"
          },
          {
            "name": "rentPayer",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "proposalApproved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "by",
            "type": "pubkey"
          },
          {
            "name": "approvals",
            "type": "u8"
          },
          {
            "name": "eta",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "proposalClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "proposalCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "proposer",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": {
              "defined": {
                "name": "govAction"
              }
            }
          },
          {
            "name": "eta",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "proposalExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "action",
            "type": {
              "defined": {
                "name": "govAction"
              }
            }
          }
        ]
      }
    },
    {
      "name": "proposalVetoed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "by",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "role",
      "docs": [
        "Which role performed a protective action (reported in events)."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "owner"
          },
          {
            "name": "guardian"
          },
          {
            "name": "ai"
          }
        ]
      }
    },
    {
      "name": "swept",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "by",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "safeAddress",
            "type": "pubkey"
          },
          {
            "name": "frozen",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "trustedWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vault",
      "docs": [
        "A self-custodial savings vault. PDA: `[\"vault\", creator, vault_id_le]`.",
        "",
        "Seeds use `creator` (immutable), never `owner` (rotatable)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "vaultId",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "ownerEpoch",
            "docs": [
              "Bumped on owner rotation. Pending withdrawals must match it (INV-6)."
            ],
            "type": "u32"
          },
          {
            "name": "guardians",
            "docs": [
              "Unused slots are `Pubkey::default()`."
            ],
            "type": {
              "array": [
                "pubkey",
                5
              ]
            }
          },
          {
            "name": "guardianCount",
            "type": "u8"
          },
          {
            "name": "threshold",
            "type": "u8"
          },
          {
            "name": "guardianEpoch",
            "docs": [
              "Bumped whenever the guardian set or threshold changes (INV-7)."
            ],
            "type": "u32"
          },
          {
            "name": "aiGuardian",
            "docs": [
              "`Pubkey::default()` means no AI guardian."
            ],
            "type": "pubkey"
          },
          {
            "name": "safeAddress",
            "docs": [
              "Wallet that receives an emergency sweep (its ATA for `mint`)."
            ],
            "type": "pubkey"
          },
          {
            "name": "delaySeconds",
            "type": "i64"
          },
          {
            "name": "dailyLimit",
            "type": "u64"
          },
          {
            "name": "windowStart",
            "type": "i64"
          },
          {
            "name": "spentInWindow",
            "type": "u64"
          },
          {
            "name": "frozen",
            "type": "bool"
          },
          {
            "name": "trustedCount",
            "type": "u8"
          },
          {
            "name": "nextWithdrawalId",
            "type": "u64"
          },
          {
            "name": "nextProposalId",
            "type": "u64"
          },
          {
            "name": "reserved",
            "docs": [
              "Reserved for future fields, so we never need a realloc."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "vaultInitialized",
      "docs": [
        "Program events (PROGRAM-SPEC §6). Sentinel subscribes to these."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "guardianCount",
            "type": "u8"
          },
          {
            "name": "threshold",
            "type": "u8"
          },
          {
            "name": "aiGuardian",
            "type": "pubkey"
          },
          {
            "name": "safeAddress",
            "type": "pubkey"
          },
          {
            "name": "delaySeconds",
            "type": "i64"
          },
          {
            "name": "dailyLimit",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "withdrawal",
      "docs": [
        "A pending delayed withdrawal. PDA: `[\"withdrawal\", vault, id_le]`.",
        "It exists only while pending. Execute or cancel closes it."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "destination",
            "docs": [
              "Destination **token account** (mint checked at request and execute)."
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "requestedAt",
            "type": "i64"
          },
          {
            "name": "executesAt",
            "type": "i64"
          },
          {
            "name": "ownerEpoch",
            "docs": [
              "`vault.owner_epoch` at request time (INV-6)."
            ],
            "type": "u32"
          },
          {
            "name": "rentPayer",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "withdrawalCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "by",
            "type": "pubkey"
          },
          {
            "name": "byRole",
            "type": {
              "defined": {
                "name": "role"
              }
            }
          }
        ]
      }
    },
    {
      "name": "withdrawalExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "destination",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "withdrawalRequested",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "executesAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "trustedAddress",
      "docs": [
        "A trusted destination wallet. PDA: `[\"trusted\", vault, wallet]`.",
        "Created only by an executed `AddTrusted` proposal."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "activeAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "maxDelay",
      "type": "i64",
      "value": "2592000"
    },
    {
      "name": "maxGuardianSlots",
      "type": "u8",
      "value": "5"
    },
    {
      "name": "maxTrusted",
      "docs": [
        "Trusted-address cap per vault."
      ],
      "type": "u8",
      "value": "10"
    },
    {
      "name": "minDelay",
      "docs": [
        "Timelock bounds, in seconds. 60 s is the minimum so the devnet demo can show a",
        "full cycle. The UI defaults to 86,400."
      ],
      "type": "i64",
      "value": "60"
    },
    {
      "name": "proposalSeed",
      "type": "bytes",
      "value": "[112, 114, 111, 112, 111, 115, 97, 108]"
    },
    {
      "name": "proposalTtl",
      "docs": [
        "A proposal must reach its threshold within this many seconds of creation."
      ],
      "type": "i64",
      "value": "604800"
    },
    {
      "name": "trustedSeed",
      "type": "bytes",
      "value": "[116, 114, 117, 115, 116, 101, 100]"
    },
    {
      "name": "vaultSeed",
      "type": "bytes",
      "value": "[118, 97, 117, 108, 116]"
    },
    {
      "name": "windowSeconds",
      "docs": [
        "Length of the instant-allowance window."
      ],
      "type": "i64",
      "value": "86400"
    },
    {
      "name": "withdrawalSeed",
      "type": "bytes",
      "value": "[119, 105, 116, 104, 100, 114, 97, 119, 97, 108]"
    }
  ]
};
