#!/bin/bash

OUTPUT_FILE="/tmp/qbittorrent-debug2.txt"

echo "===============================" >> "$OUTPUT_FILE"
echo "Timestamp: $(date)" >> "$OUTPUT_FILE"
echo "-------------------------------" >> "$OUTPUT_FILE"

echo "N (Name): $1" >> "$OUTPUT_FILE"
echo "L (Category): $2" >> "$OUTPUT_FILE"
echo "G (Tags): $3" >> "$OUTPUT_FILE"
echo "F (Content Path): $4" >> "$OUTPUT_FILE"
echo "R (Root Path): $5" >> "$OUTPUT_FILE"
echo "D (Save Path): $6" >> "$OUTPUT_FILE"
echo "C (Number of Files): $7" >> "$OUTPUT_FILE"
echo "Z (Size Bytes): $8" >> "$OUTPUT_FILE"
echo "T (Current Tracker): $9" >> "$OUTPUT_FILE"
echo "I (Info Hash v1): ${10}" >> "$OUTPUT_FILE"
echo "J (Info Hash v2): ${11}" >> "$OUTPUT_FILE"
echo "K (Torrent ID): ${12}" >> "$OUTPUT_FILE"

echo "" >> "$OUTPUT_FILE"

