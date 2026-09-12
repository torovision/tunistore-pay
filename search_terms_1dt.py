import sys

def search_pcap(filename):
    print(f"--- Analyzing {filename} ---")
    try:
        with open(filename, 'rb') as f:
            data = f.read()
            for term in [b'1000', b'1.000', b'1,000', b'POST ', b'GET ', b'HTTP/1.1', b'amount']:
                if term in data:
                    print(f"Found '{term.decode()}' in {filename}")
                else:
                    pass
    except Exception as e:
        print(f"Error: {e}")

search_pcap(r"C:\Users\Fredson\Desktop\PCAPdroid_12_Sep_17_43_37.pcap")
search_pcap(r"C:\Users\Fredson\Desktop\PCAPdroid_12_Sep_17_56_53.pcap")
