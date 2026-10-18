#!/bin/sh
# 构建并发布到 GitHub Pages（gh-pages 分支）
set -e
cd "$(dirname "$0")/app"
npm run build
cd dist
touch .nojekyll
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name=jasper251k -c user.email="$(git -C ../.. config user.email)" commit -qm "deploy"
git push -qf "$(git -C ../.. remote get-url origin)" gh-pages
rm -rf .git
echo "已发布：https://jasper251k.github.io/540paizhao/"
