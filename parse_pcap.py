import sys
import re

def search_pcap(filename):
    print(f"--- Analyzing {filename} ---")
    try:
        with open(filename, 'rb') as f:
            data = f.read()
            
            # Find printable strings that look like HTTP requests
            # Let's search for "POST " or "api.kashy.tn" or "pay.kashy.tn"
            
            matches = re.finditer(b'POST (?:/[^\s]*) HTTP/1\.[01]', data)
            count = 0
            for m in matches:
                start = max(0, m.start() - 10)
                end = min(len(data), m.end() + 1000)
                print(f"\nMatch {count}:")
                # Try to print up to the first double newline (end of headers)
                snippet = data[start:end]
                try:
                    text = snippet.decode('utf-8', errors='ignore')
                    print(text[:500])
                except:
                    pass
                count += 1
                if count > 10: break
                
            print(f"Found {count} POST requests.")
            
            # Also search for ANY occurrence of api.kashy.tn
            if b'api.kashy.tn' in data:
                print("Found 'api.kashy.tn' in the PCAP.")
                # find context around the first occurrence
                idx = data.find(b'api.kashy.tn')
                print(data[max(0, idx-100):min(len(data), idx+500)].decode('utf-8', errors='ignore'))
            else:
                print("Did not find 'api.kashy.tn' in the PCAP.")
                
    except Exception as e:
        print(f"Error reading {filename}: {e}")

search_pcap(r"C:\Users\Fredson\Desktop\PCAPdroid_12_Sep_17_43_37.pcap")
search_pcap(r"C:\Users\Fredson\Desktop\PCAPdroid_12_Sep_17_56_53.pcap")
