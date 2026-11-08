# English-first catalog builds

The default compilation, packaging and scratch import language is en. Additional supported languages must be selected explicitly with the workflow language input, for example en,ja. Admin language installation controls remain unfinished; a language picker in the existing UI is not evidence that its snapshot or scan index is installed.

The temporary compiler copy has its actual LANGS loop scoped to the requested languages. Git last-edit indexing runs only over the source folders those languages use: data for English/European languages and data-asia for the Asian languages. Empty newline entries are removed before Git-history lookups; genuine lookup failures still report the filename. The previously observed two blank filename warnings were caused by those empty entries, not SQLite imports.

English-only builds do not apply the BW3b correction or process Asian source history. Explicit Asian-language builds retain that reviewed correction. The validation report records compiler scope, selected source folders and transformation hashes alongside source corrections.

This is a candidate-bundle CI build, not a new full compilation task on server startup. The sync controller already defaults to en, but runtime bundle delivery and complete local API cutover still require integration. The repository checkout remains complete and per-file Git-history work remains for the selected source tree; runtime reductions must be measured, not assumed. Existing stored languages and user data are not removed. Set-scoped installation controls and final Admin/README reconciliation remain release requirements.
