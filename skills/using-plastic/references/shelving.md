# Shelving

## Save Work

```bash
cm shelveset create -c="Working on feature X"
```

## List Shelves

```bash
cm find shelve "where owner='me'" --format="{shelveid} {date} {comment}"
```

## Restore Work

```bash
cm shelveset apply sh:5
```

## Delete Shelve

```bash
cm shelveset delete sh:5
```
