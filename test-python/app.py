
import time
import random
import sys

print("🐍 Starting Python application...")
print("📁 Project: test-python")

count = 0
while True:
    count += 1
    
    if count % 8 == 0:
        print("❌ ImportError: No module named 'requests'", file=sys.stderr)
    elif count % 12 == 0:
        print("✅ Database connection successful")  
    elif count % 5 == 0:
        print(f"📊 Processing data batch {random.randint(1, 100)}")
    else:
        print(f"[INFO] Application running - iteration {count}")
    
    time.sleep(3)
    