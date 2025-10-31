import os
import json


def process_json_file(file_path):
    with open(file_path, "r") as file:
        data = json.load(file)

    if isinstance(data, list) and len(data) > 20:
        data = data[5:15]

    with open(file_path, "w") as file:
        json.dump(data, file, indent=4)
        print(f"Processed {file_path}")


def main():
    directory = "../data/alphabets"
    for filename in "ABCDEFGHIKLMNOPQRSTUVWXY":
        filename += ".json"
        file_path = os.path.join(directory, filename)
        process_json_file(file_path)


if __name__ == "__main__":
    main()
