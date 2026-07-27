# RFC 3161 trust policy

OpenDART temporal holdout artifacts require independent timestamp receipts from
both configured authorities. Verification is performed against the pinned
certificate files in this directory; the operating-system trust store and Git
commit dates are not used as time evidence.

| Authority | Policy OID | Root SHA-256 |
| --- | --- | --- |
| DigiCert Timestamp 2025 | `2.16.840.1.114412.7.1` | `3E:90:99:B5:01:5E:8F:48:6C:00:BC:EA:9D:11:1E:E7:21:FA:BA:35:5A:89:BC:F1:DF:69:56:1E:3D:C6:32:5C` |
| FreeTSA | `1.2.3.4.1` | `A6:37:9E:7C:EC:C0:5F:AA:3C:BF:07:60:13:D7:45:E3:27:BB:BA:A3:8C:0B:9A:F2:24:69:D4:70:1D:18:AA:BC` |

Both current timestamp tokens report `Accuracy: unspecified`. The protocol
therefore pins that exact value and adds a conservative 24-hour **operational
safety buffer** before corpus collection. This is not an RFC 3161 accuracy
bound and cannot make a result independently claim-eligible. A contract TSA
whose policy OID has a documented numeric accuracy bound must replace these
operational authorities before the external-independence gate can pass. Any
future change in the reported accuracy fails closed until this policy and the
verifier are deliberately revised.

RFC 3161 responses are capped at 256 KiB. Payload imprint, request nonce,
policy OID, DER hashes, response signature, certificate chain, and the pinned
authority manifest are all verified before a timestamp can establish an
operational collection boundary.
