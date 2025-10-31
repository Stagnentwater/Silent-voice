import os
import json
import psycopg2
from dotenv import load_dotenv

load_dotenv()

db = psycopg2.connect(
    database="poses",
    host="localhost",
    user="postgres",
    password=os.getenv("POSTGRES_PASSWORD"),
    port=5432,
)
cur = db.cursor()


def fetch_signs_for_letter(letter):
    cur.execute(
        "SELECT word, poses FROM signs WHERE UPPER(word) = %s", (letter,)
    )
    result = cur.fetchone()
    print(letter)
    if result:
        return result[1]
    return None


for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
    sign_data = fetch_signs_for_letter(letter)
    if sign_data:
        with open(f"../data/alphabets/{letter}.json", "w") as json_file:
            json.dump(sign_data, json_file)

cur.close()
db.close()
