import csv
import json
import math

input_csv = "../data/text2gloss.csv"
finetune_csv = "../data/text2gloss-finetune.jsonl"
validation_csv = "../data/text2gloss-validation.jsonl"

messages_finetune = []
messages_validation = []

with open(input_csv, mode="r", encoding="utf-8") as csvfile:
    csvreader = csv.reader(csvfile)
    next(csvreader)

    all_rows = list(csvreader)
    total_rows = len(all_rows)
    validation_count = math.ceil(total_rows * 0.15)

    validation_rows = all_rows[:validation_count]
    finetune_rows = all_rows[validation_count:]

    for row in finetune_rows:
        gloss, text = row
        messages_finetune.append(
            {
                "messages": [
                    {
                        "role": "system",
                        "content": "Translate English to ASL Gloss Grammar",
                    },
                    {
                        "role": "user",
                        "content": text,
                    },
                    {
                        "role": "assistant",
                        "content": gloss,
                    },
                ]
            }
        )

    for row in validation_rows:
        gloss, text = row
        messages_validation.append(
            {
                "messages": [
                    {
                        "role": "system",
                        "content": "Translate English to ASL Gloss Grammar",
                    },
                    {
                        "role": "user",
                        "content": text,
                    },
                    {
                        "role": "assistant",
                        "content": gloss,
                    },
                ]
            }
        )

with open(finetune_csv, mode="w", encoding="utf-8") as jsonlfile:
    for message in messages_finetune:
        jsonlfile.write(json.dumps(message) + "\n")

with open(validation_csv, mode="w", encoding="utf-8") as jsonlfile:
    for message in messages_validation:
        jsonlfile.write(json.dumps(message) + "\n")
