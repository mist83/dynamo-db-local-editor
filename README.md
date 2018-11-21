Features:
- table list
- table (schema) description
- sorting
- expand/collapse all values in grid (useful for ctrl+f searching)
- searching (via JavaScript and evil "eval" of what's in the text box)
- create new item
- edit existing item
- pretty print (I didn't have time to troubleshoot, but this only works on existing records)

Not implemented:
- Create table
- Delete table
- Delete record
- any sort of indexes / RCUs / WCUs / any other concern for AWS-hosted Dynamo DB
