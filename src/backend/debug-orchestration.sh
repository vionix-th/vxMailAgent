#!/bin/bash

# Orchestration debugging script with comprehensive analysis
# Usage: ./debug-orchestration.sh [user_id]

USER_ID=${1:-"google:115075331003198785424"}

echo "🔐 Generating JWT token for user: $USER_ID"
TOKEN=$(node utils/test-auth.js "$USER_ID" | grep "Token:" | cut -d' ' -f2)

if [ -z "$TOKEN" ]; then
    echo "❌ Failed to generate token"
    exit 1
fi

export VX_TEST_TOKEN="$TOKEN"
echo "✅ Token generated"
echo ""

# Function to format timestamp
format_time() {
    if command -v gdate >/dev/null 2>&1; then
        gdate -d "$1" '+%H:%M:%S'
    else
        date -j -f "%Y-%m-%dT%H:%M:%S" "${1%.*}" '+%H:%M:%S' 2>/dev/null || echo "$1"
    fi
}

echo "🔍 ORCHESTRATION ANALYSIS"
echo "========================"

echo ""
echo "📊 Current Orchestration Status:"
DIAGNOSTICS=$(curl -s -H "Authorization: Bearer $VX_TEST_TOKEN" http://localhost:3001/api/orchestration/diagnostics)
TOTAL_LOGS=$(echo "$DIAGNOSTICS" | jq -r '.total')
echo "Total orchestration logs: $TOTAL_LOGS"

echo ""
echo "💬 Active Conversations:"
CONVERSATIONS=$(curl -s -H "Authorization: Bearer $VX_TEST_TOKEN" http://localhost:3001/api/conversations)
ONGOING_COUNT=$(echo "$CONVERSATIONS" | jq '.items | map(select(.status == "ongoing")) | length')
TOTAL_CONVS=$(echo "$CONVERSATIONS" | jq '.items | length')
echo "Ongoing conversations: $ONGOING_COUNT / $TOTAL_CONVS"

if [ "$ONGOING_COUNT" -gt 0 ]; then
    echo ""
    echo "🚨 STUCK CONVERSATIONS DETECTED:"
    echo "$CONVERSATIONS" | jq -r '.items[] | select(.status == "ongoing") | "  Thread: \(.id) | Kind: \(.kind) | Messages: \(.messages | length) | Last Active: \(.lastActiveAt)"'
    
    echo ""
    echo "🕐 Time Analysis (last 10 orchestration events):"
    echo "$DIAGNOSTICS" | jq -r '.items[0:10] | .[] | "\(.timestamp) | \(.agent) | \(.emailSummary)"' | while read line; do
        timestamp=$(echo "$line" | cut -d'|' -f1 | xargs)
        rest=$(echo "$line" | cut -d'|' -f2- | xargs)
        formatted_time=$(format_time "$timestamp")
        echo "  $formatted_time | $rest"
    done
fi

echo ""
echo "🔧 DIAGNOSTIC COMMANDS:"
echo "# Check specific conversation:"
echo "curl -s -H \"Authorization: Bearer \$VX_TEST_TOKEN\" http://localhost:3001/api/conversations/[thread_id] | jq '.messages[-1]'"
echo ""
echo "# Check orchestration active steps:"
echo "curl -s -H \"Authorization: Bearer \$VX_TEST_TOKEN\" http://localhost:3001/api/orchestration/active"
echo ""
echo "# Trigger new email fetch:"
echo "curl -X POST -H \"Authorization: Bearer \$VX_TEST_TOKEN\" http://localhost:3001/api/fetcher/run"
echo ""
echo "# Cancel all active steps:"
echo "curl -X DELETE -H \"Authorization: Bearer \$VX_TEST_TOKEN\" http://localhost:3001/api/orchestration/active"

echo ""
echo "🎯 ANALYSIS SUMMARY:"
if [ "$ONGOING_COUNT" -eq 0 ]; then
    echo "✅ No stuck conversations detected"
    echo "✅ Orchestration appears healthy"
else
    echo "⚠️  Found $ONGOING_COUNT ongoing conversations"
    echo "⚠️  These may be stuck in orchestration"
    echo "⚠️  Check if they have pending tool calls or errors"
fi
