#!/bin/bash

# 部署脚本
# 使用 scp 部署到远程服务器的制定目录
# 服务器地址，服务器目录可以通过命令后参数控制

# 设置变量
SERVER=$1
REMOTE_DIR=$2
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 检查参数
if [ $# -lt 2 ]; then
    echo "Usage: $0 <server> <remote_dir>"
    echo "Example: $0 user@server.com /opt/app"
    exit 1
fi
if [ ! -d "$LOCAL_DIR" ]; then
    echo "Error: $LOCAL_DIR 不是一个目录"
    exit 1
fi
# 执行部署
echo "开始部署到 $SERVER:$REMOTE_DIR"
scp -r "$LOCAL_DIR"/* "$SERVER:$REMOTE_DIR"

if [ $? -eq 0 ]; then
    echo "部署成功"
else
    echo "部署失败"
    exit 1
fi