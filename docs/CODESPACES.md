# Codespaces development

Use the `feature/collection-enhancements` branch, or a branch cut from it, when
creating a Codespace. The container is Node 20 on Debian. It installs
dependencies once, builds the frontend once, and runs the standalone
opening-accounting test. That test is also picked up by `npm test`, because
`backend/test/run.js` runs every `backend/test/*.test.js`.

## Start and resume

Creating the Codespace runs `bash .devcontainer/setup.sh`. Starting it again,
including after a stop, runs `bash .devcontainer/start.sh --background`. The
server log is `.devcontainer/data/start.log`.

To start it yourself in a terminal:

```sh
bash .devcontainer/start.sh
```

If port 3001 is already open, the script leaves that process alone. It does
not reinstall dependencies. After a lockfile change, run `npm ci` in the
package that changed (`npm ci`, `npm ci --prefix backend`, or
`npm ci --prefix frontend`).

Open forwarded port 3001 from the Ports panel and keep its visibility private.
The page and the API are the same origin: Express serves the built frontend.
Codespaces presents that forwarded port over HTTPS, which is what the browser
needs for the camera. The server itself listens with HTTP. There is no Vite
dev server and no hot reload. A frontend edit rebuilds the production bundle;
refresh the browser after that build finishes. A backend JavaScript edit
restarts through nodemon.

## First account and data

The database is `.devcontainer/data/bindarr.db`. Git ignores that directory.
It stays across stop and resume of the same Codespace. Deleting the Codespace
can delete it. This path is not the household collection. Do not point
`DB_PATH` at a production file.

An empty database does not print a password. The first browser visit asks you
to create the `admin` account. Choose a password of at least 8 characters.
Self-registration stays off. The account remains in the database after a
restart, so you log in on the next resume instead of creating it again.

## Secrets

Put `POKEWALLET_API_KEY` in a repository Codespaces secret if you want live
price lookups. The server reads it. The browser bundle does not. A missing
key leaves prices unchanged and the Admin page says the key is not configured.
Do not commit `.env` or paste the key into chat, logs, or screenshots.

Provider calls and scanner model downloads may still use external services.
This is not an offline sandbox. Turn automatic price refresh off in Admin
while testing unrelated UI. PokéWallet does not change the TCGCSV User-Agent
and does not try to get around a block on that service.

## Tests

```sh
node backend/test/openingAccounting.test.js
npm test
npm run lint --prefix frontend
npm run check:locales --prefix frontend
```

Codespaces may consume your included GitHub quota and incur charges depending
on the account. Stop the Codespace when you are finished. This configuration
has been reviewed and the same install, build, and server commands have been
run outside a Codespace. A live GitHub Codespace, a phone camera, and a
stop/resume cycle have not been executed from this environment.
