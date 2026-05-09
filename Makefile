.PHONY: all build build-ext build-webview watch package install clean

VSIX := $(wildcard *.vsix)

all: build

# Compile both targets
build: build-ext build-webview

# Compile TypeScript extension host → out/
build-ext: node_modules
	npm run compile

# Build React webview → out/webview/
build-webview: node_modules
	npm run compile-webview

# Incremental watch build (extension host only)
watch: node_modules
	npm run watch

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

