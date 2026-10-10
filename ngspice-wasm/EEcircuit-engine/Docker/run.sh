#!/bin/bash
echo "build: Entryponit script is Running..."

echo "build: Installing emscripten..."

NGSPICE_HOME="https://github.com/danchitnis/ngspice-sf-mirror"
#NGSPICE_HOME="https://git.code.sf.net/p/ngspice/ngspice"

echo "build: ngsice git repository is $NGSPICE_HOME"

cd /opt
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh

echo "build: emscripten is installed"

############################################

echo -e "\n"
echo "build: cloning ngspice repository..."

cd /opt
git clone $NGSPICE_HOME ngspice-ngspice
cd ngspice-ngspice

############################################

echo -e "\n"
echo "build: determining the latest release version and branch..."

# Step 1: Find the latest tag with the version format "ngspice-X.Y"
latest_tag=$(git tag | grep -E '^ngspice-[0-9]+\.[0-9]+$' | sort -V | tail -n 1)
if [ -z "$latest_tag" ]; then
  echo "build: No ngspice tags found."
  exit 1
fi
latest_version=${latest_tag#ngspice-}  # Extract version number (e.g., 44.2)
echo "build: Latest tag: $latest_tag (version $latest_version)"

# Step 2: Find the branch with a higher version than the latest tag.
# We assume branch names are in the form "pre-master-X" or "pre-master-X.Y"
# Extract the version number, sort them, and then pick the first branch with a version > latest_version.
branch_version=$(git branch -r | \
  grep -Eo 'pre-master-[0-9]+(\.[0-9]+)?' | \
  sed -E 's/.*pre-master-([0-9]+(\.[0-9]+)?)/\1/' | \
  sort -V | \
  awk -v latest="$latest_version" '{ if ($1+0 > latest+0) { print $1; exit } }')

if [ -n "$branch_version" ]; then
  echo "build: Branch with higher version: pre-master-$branch_version"
else
  echo "build: No branch found with a version higher than $latest_version"
  exit 1
fi

############################################

echo -e "\n"
echo "build: Running build requested is: $VERSION"

if [ "$VERSION" == "next" ]; then
  echo "build: Checking out the branch pre-master-$branch_version"
  git checkout "pre-master-$branch_version" || { echo "build: Checkout failed, stopping execution"; exit 1; }
else
  echo "build: Checking out the master branch for version $latest_version"
fi

############################################

echo -e "\n"
echo "build: Applying hicum2 removal patch"

cp /hicum2_patch.sh ./hicum2_patch.sh
./hicum2_patch.sh || { echo "build: hicum2 patch failed, stopping execution"; exit 1; }

############################################

echo -e "\n"
echo "build: Applying patches..."
echo "build: Branch name is $(git branch --show-current)"


# Source patches (code models, no clock, static libngspice, ...) are applied
# by build-wasm.sh; the asyncify yield hooks older builds sed'ed in here are
# gone - the engine now calls ngspice's shared-library API synchronously.

############################################

echo -e "\n"
echo "build: Building ngspice..."

# Configure, build the XSPICE code models and link them statically into
# spice.wasm (see build-wasm.sh and static-cm/cmstatic.c).
bash /mnt/build-wasm.sh . /mnt/build || { echo "build: Make failed, stopping execution"; exit 1; }

echo "build: Build artifacts are copied to /mnt/build"

############################################

echo -e "\n"
echo -e "build: Docker script is ended\n"





