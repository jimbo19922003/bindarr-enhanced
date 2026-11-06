# Codespaces development

Create the Codespace from a branch that contains `.devcontainer/devcontainer.json`.
`main` at the 1.8.8 release does not contain that folder. A Codespace created
from `main` has an empty Ports panel because no dev container is configured and
nothing starts a server. Changing the Git branch inside that Codespace does not
apply this file until you run **Codespaces: Rebuild Container** from the
Command Palette, or you create a new Codespace from this branch.

On a pull request, use the pull request's **Code** button and create the
Codespace on the pull request branch. From the repository, use **Code →
Codespaces → New with options** and pick the branch.

The container is Node 20 on Debian. The first create installs dependencies
once, builds the frontend once, and runs the standalone opening-accounting
test. That test is also picked up by `npm test`, because `backend/test/run.js`
runs every `backend/test/*.test.js`.

## Start and resume

Creating the Codespace runs `bash .devcontainer/setup.sh` and then opens the
editor. The editor does not wait for the app. After it connects, the terminal
runs `bash .devcontainer/start.sh --ensure`. The server log is
`.devcontainer/data/start.log`.

A window that stays on "Opening remote..." was built from the previous
container config, which waited for the app process before connecting. Stop or
delete that Codespace at https://github.com/codespaces and create a new one
from this branch. Resuming the stuck one uses the same startup command.

When the app is up, the terminal prints `http://localhost:3001` and the Ports
panel lists port **3001** as **Bindarr test instance**. A preview of that port
opens in the editor. Keep the port visibility private. The page and the API
are the same origin: Express serves the built frontend. Codespaces presents
that forwarded port over HTTPS, which is what the browser needs for the
camera. The server itself listens with HTTP.

To start it yourself in a terminal:

```sh
bash .devcontainer/start.sh
```

If port 3001 is already open, the script leaves that process alone. It does
not reinstall dependencies. After a lockfile change, run `npm ci` in the
package that changed (`npm ci`, `npm ci --prefix backend`, or
`npm ci --prefix frontend`).

There is no Vite dev server and no hot reload. A frontend edit rebuilds the
production bundle; refresh the browser after that build finishes. A backend
JavaScript edit restarts through nodemon.

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
