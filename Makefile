.PHONY: all build build-ext build-web build-webview check watch watch-web package install clean

VSIX := $(wildcard *.vsix)

all: build

# Compile extension host bundles and webview assets
build: build-ext build-web build-webview

# Bundle desktop extension host → out/extension-node.js (with all deps inlined)
build-ext: node_modules
	npm run bundle-ext

# Bundle web extension host → out/extension-web.js (with all deps inlined)
build-web: node_modules
	npm run bundle-web

# Type-check only (no emit) — run separately for CI
typecheck: node_modules
	npm run typecheck

# Run the compatibility checks used for CI and packaging
check: node_modules
	npm run check

# Build React webview → out/webview/
build-webview: node_modules
	npm run compile-webview

# Incremental watch build (desktop extension host only)
watch: node_modules
	npm run watch

# Incremental watch build (web extension host only)
watch-web: node_modules
	npm run watch-web

# Install npm deps if missing
node_modules: package.json
	npm install
	@touch node_modules

# Package into a .vsix file
package: build
	npm run package

# Install the latest .vsix into VS Code
install: package
	@vsix=$$(ls -t *.vsix 2>/dev/null | head -1); \
	if [ -z "$$vsix" ]; then echo "No .vsix found. Run 'make package' first."; exit 1; fi; \
	echo "Installing $$vsix ..."; \
	code --install-extension "$$vsix"

# Remove build artifacts
clean:
	rm -rf out/ *.vsix

