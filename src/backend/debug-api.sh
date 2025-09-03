#!/bin/bash

# Backend API debugging script with authentication
# Usage: ./debug-api.sh [user_id]

USER_ID=${1:-"google:115075331003198785424"}

echo "🔐 Generating JWT token for user: $USER_ID"
TOKEN=$(node utils/test-auth.js "$USER_ID" | grep "Token:" | cut -d' ' -f2)

if [ -z "$TOKEN" ]; then
    echo "❌ Failed to generate token"
    exit 1
fi

export VX_TEST_TOKEN="$TOKEN"
echo "✅ Token generated and exported as VX_TEST_TOKEN"
echo ""

# Test core endpoints
echo "🧪 Testing authenticated endpoints:"
echo ""

echo "📊 Fetcher Status:"
curl -s -H "Authorization: Bearer $VX_TEST_TOKEN" http://localhost:3001/api/fetcher/status | jq .
echo ""

echo "📧 Accounts:"
curl -s -H "Authorization: Bearer $VX_TEST_TOKEN" http://localhost:3001/api/accounts | jq .
echo ""

echo "⚙️  Settings:"
curl -s -H "Authorization: Bearer $VX_TEST_TOKEN" http://localhost:3001/api/settings | jq .
echo ""

echo "💬 Conversations (first 3):"
curl -s -H "Authorization: Bearer $VX_TEST_TOKEN" http://localhost:3001/api/conversations | jq '.[0:3]'
echo ""

echo "🔍 Diagnostics Stats:"
curl -s -H "Authorization: Bearer $VX_TEST_TOKEN" http://localhost:3001/api/cleanup/stats | jq .
echo ""

echo "🚀 Manual Commands:"
echo "export VX_TEST_TOKEN=\"$TOKEN\""
echo "curl -H \"Authorization: Bearer \$VX_TEST_TOKEN\" http://localhost:3001/api/[endpoint]"
echo ""
echo "📝 Trigger email fetch:"
echo "curl -X POST -H \"Authorization: Bearer \$VX_TEST_TOKEN\" http://localhost:3001/api/fetcher/run"
