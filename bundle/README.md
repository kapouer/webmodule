@webmodule/bundle -- bundle assets of an html document
======================================================

Features
--------

* recursively concatenate scripts, styles, and link[rel=import]
* minify scripts and stylesheets
* vendor autoprefixing of stylesheets, configurable through env, see
  [browserslist](https://github.com/browserslist/browserslist)
* bundle everything in one single js file, or split in js / css.
* prepend or append additional scripts, styles, or imports
* exclude or ignore a tag by matching a url substring
  new in version 1.8.0: or a minimatch pattern with wildcard (see example below)
* modify the DOM and outputs html
* downloads remote scripts or stylesheets with whitelist (new in 1.7.0)
* allows custom asynchronous DOM modifications (new in 1.6.0)
* any kind of modules are supported, thanks to rollup
* relative imports can be resolved using modules option.

Install
-------

`npm install -g @webmodule/bundle`

Usage
-----

This saves modified html file, and styles are bundled into js file:

```bash
webmodule-bundle
--html bundles/index.html
--js /bundles/index.js
-x jquery.js -x moment.js -i index.js
--prepend '/js/custom-elements.js'
public/index.html
```

This saves styles separately:

```bash
webmodule-bundle
--html bundles/index.html
--css /bundles/index.css
--js /bundles/index.js
--exclude jquery.js
--prepend '/js/custom-elements.js'
public/index.html
```

This does not compress files, and specifies root dir

```bash
webmodule-bundle
--concatenate
--html bundles/index.html
--css /bundles/index.css
--js /bundles/index.js
--exclude jquery.js
--prepend '/js/custom-elements.js'
--root public
public/templates/index.html
```

A tool to bundle a bunch of files:

```bash
webmodule-bundle-all
  --filter "**/excluded-*.*"
  --common common.html
  --suffix 1.0.0
  "templates/*.html"
```

it bundles common files then processes all files matching pattern and put
everything with suffixes in a bundles/ directory.

See `webmodule-bundle-all -h` for more command-line options.

Paths are relative to the input file path.

API
---

`webmoduleBundle(path, opts, cb)`

where `path` is the path of the html file to process,
and `opts` has these properties:

* exclude: array of matched strings
* ignore: array of matched strings
* append: array of strings
* prepend: array of strings
* js: path relative to html file
* css: path relative to html file
* html: path relative to root
* root: absolute mount path, defaults to current directory
* custom: function(dom, opts, data) {} returning a promise
* remotes: list of allowed remote domains to download from
* modulesPrefix: the mount path for resolving node_modules (<modules> becomes <modules>/node_modules/xxx/index.js), defaults to "/".
* modulesRoot: where node modules are to be found. Defaults to ".".
* assets: if set, copy stylesheets assets to this path relative to root.
* analyze: boolean, get information about bundle

Strings are matched simply by searching a substring.

Tags without src or href attributes can be excluded or ignored by passing a
dot ".", otherwise they are bundled.

Omitting js, css options skips the insertion of the corresponding tag in the
html document.

If cb is omitted, returns a promise.

Returns an object with following properties:

* js, css, html: the resulting js, css, html
* scripts, stylesheets, assets, imports: the lists of processed files

Help
----

`webmodule-bundle --help`

License
-------

MIT, see LICENSE file.
