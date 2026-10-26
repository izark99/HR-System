# vendor/

Third-party packages committed to the repository because they are not published to the npm
registry. pnpm installs them via `file:` dependencies and records their integrity in
`pnpm-lock.yaml`, so `pnpm install --frozen-lockfile` fails if a tarball is changed.

## xlsx-0.20.3.tgz — SheetJS Community Edition

| Field       | Value                                                                       |
| ----------- | --------------------------------------------------------------------------- |
| Package     | `xlsx` (SheetJS CE)                                                         |
| Version     | 0.20.3                                                                      |
| Source      | https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz                         |
| License     | Apache-2.0 (see `package/LICENSE` inside the tarball)                       |
| SHA-256     | `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`          |
| Used by     | `apps/web` (`"xlsx": "file:../../vendor/xlsx-0.20.3.tgz"`) — reading Excel |

SheetJS stopped publishing to the npm registry after 0.18.5; current versions are distributed
only from cdn.sheetjs.com.

### Upgrading

1. Download the new tarball from `https://cdn.sheetjs.com/xlsx-<version>/xlsx-<version>.tgz`
   into this folder and delete the old one.
2. Verify it: `sha256sum vendor/xlsx-<version>.tgz`, check `package/package.json` (name,
   version, license) and the SheetJS changelog.
3. Update the `xlsx` dependency in `apps/web/package.json`, run `pnpm install`, and update the
   table above (version, source, SHA-256).
