{
  description = "solidjs-motion dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let pkgs = nixpkgs.legacyPackages.${system}; in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22
            bun
            lazygit
          ];
          # Real-browser test harness (Vitest browser mode + Playwright). The npm
          # `playwright` package is pinned to match nixpkgs' playwright-driver
          # version; we point Playwright at the nix-built browsers (which carry the
          # right shared libs — the prebuilt download fails on nix with a missing
          # libnspr4.so) and skip its host-requirement validation + own download.
          PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
          PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
        };
      });
}