import json,sys
d=json.load(open(sys.argv[1]))
for n,r in d.items():
    print("==",n,"errors:",r['errors']); print(" before onclick",r['before']['inlineOnclick'],r['before']['key'])
    for v in ('desktop-light','tablet','mobile'):
        x=r[v]; print(" ",v,x['htmlClass'],"injected",x['injected'],"onclick",x['inlineOnclick'],"sw",x['scrollWidth'],"/",x['viewport'],x['overflowing']); print("   ",x['key'])
