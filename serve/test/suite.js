const assert = require('assert');
const express = require('express');

const serveModule = require('..');

describe("test suite", function () {
	this.timeout(10000);
	let server, host;

	before((done) => {
		const app = express();

		app.use(serveModule({
			prefix: '/',
			root: "test"
		}));

		server = app.listen(() => {
			host = `http://localhost:${server.address().port}`;
			done();
		});
	});
	after((done) => {
		server.close(done);
	});

	it('should redirect module with main field', async () => {
		const response = await fetch(host + '/node_modules/redirect-main', {
			method: 'GET',
			headers: {
				referer: "/mymodule.js",
				accept: "*/*"
			},
			redirect: 'manual'
		});
		assert.strictEqual(
			response.headers.get('location'),
			"/node_modules/redirect-main/here/index.js"
		);
	});

	it('should redirect module with custom field', async () => {
		const response = await fetch(host + '/node_modules/redirect-custom', {
			method: 'GET',
			headers: {
				referer: "/mymodule.js",
				accept: "*/*"
			}
		});

		const body = await response.text();
		assert.ok(response.ok);
		assert.ok(body.includes('import * as Test from "/node_modules/redirect-fixed/src/test.js";'));
		assert.ok(body.includes('console.log(Test.value);'));

		const response2 = await fetch(host + '/node_modules/redirect-fixed', {
			method: 'GET',
			headers: {
				referer: "/node_modules/redirect-custom/src/index.js",
				accept: "*/*"
			}
		});
		const body2 = await response2.text();
		assert.strictEqual(
			body2,
			'const module = {exports: {}};let exports = module.exports;exports.value = 1;\n;export default module.exports'
		);
	});

	it('should redirect module with exports field', async () => {
		const response = await fetch(host + '/node_modules/redirect-exports', {
			method: 'GET',
			headers: {
				referer: "/mymodule.js",
				accept: "*/*"
			},
			redirect: 'manual'
		});
		assert.strictEqual(
			response.headers.get('location'),
			"/node_modules/redirect-exports/src/index.js"
		);
	});

	it('should reexport global module', async () => {
		const response = await fetch(host + '/node_modules/reexport/index.js', {
			method: 'GET',
			headers: {
				referer: "/mymodule.js",
				accept: "*/*"
			}
		});
		const body = await response.text();
		assert.ok(body.startsWith("const module = {exports: {}};let exports = module.exports;"));
	});

	it('should not reexport global module', async () => {
		const response = await fetch(host + '/node_modules/noreexport/index.js', {
			method: 'GET',
			headers: {
				referer: "/mymodule.js",
				accept: "*/*"
			}
		});
		const body = await response.text();
		assert.ok(!body.startsWith("const module = {exports: {}};let exports = module.exports;"));
	});

	it('should leave file untouched because referer is not js', async () => {
		const response = await fetch(host + '/node_modules/reexport/index.js', {
			method: 'GET',
			headers: {
				referer: "/myfile",
				accept: "*/*"
			}
		});
		const body = await response.text();
		assert.ok(!body.startsWith("const module = {exports: {}};let exports = module.exports;"));
	});

	it('should redirect in subdir without loop', async () => {
		const response = await fetch(host + '/node_modules/redirect-loop', {
			method: 'GET',
			headers: {
				referer: "/myfile",
				accept: "*/*"
			}
		});
		const body = await response.text();
		assert.ok(body.includes("default toto"));
	});

	it('should support style for css', async () => {
		const response = await fetch(host + '/node_modules/style', {
			method: 'GET',
			headers: {
				referer: "/myfile",
				accept: "text/css,*/*;q=0.1"
			}
		});
		const body = await response.text();
		assert.ok(body.includes("animation"));
	});

	it('should allow same module to export css or js', async () => {
		const stylesheet = await fetch(host + '/node_modules/both', {
			method: 'GET',
			headers: {
				referer: "/myfile",
				accept: "text/css,*/*;q=0.1"
			}
		});
		const stylesheetBody = await stylesheet.text();
		assert.ok(stylesheetBody.includes("animation"));
		const script = await fetch(host + '/node_modules/both', {
			method: 'GET',
			headers: {
				referer: "/myfile",
				accept: "*/*"
			}
		});
		const scriptBody = await script.text();
		assert.ok(scriptBody.includes("console.log"));
	});

	it('should support style for css in a subdir next to it', async () => {
		const response = await fetch(host + '/node_modules/style/asset/file.txt', {
			method: 'GET',
			headers: {
				referer: "/node_modules/style/css/index.css",
				accept: "text/css,*/*;q=0.1"
			}
		});
		const body = await response.text();
		assert.ok(body.includes("some text"));
	});

	it('should return 404 when there is not module', async () => {
		const response = await fetch(host + '/node_modules/inexistent', {
			method: 'GET',
			headers: {
				referer: "/myfile"
			}
		});
		assert.strictEqual(response.status, 404);
	});

	it('should return 404 when module has nothing to export', async () => {
		const response2 = await fetch(host + '/node_modules/nothing', {
			method: 'GET',
			headers: {
				referer: "/myfile",
				accept: "text/css,*/*;q=0.1"
			}
		});
		assert.strictEqual(response2.status, 404);
	});
});
