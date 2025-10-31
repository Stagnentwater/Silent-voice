with open("../data/text2gloss.csv", "r") as file:
    content = file.read()

words = content.split()
word_count = len(words)
print(f"The number of words in text2gloss.csv is: {word_count}")
