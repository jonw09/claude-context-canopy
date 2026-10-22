# Context Canopy

## Commits

Author every commit as `jonw09` with GitHub's no-reply address, and credit Claude as co-author in a trailer:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

Set the identity before committing if it is not already set:

```
git config user.name "jonw09"
git config user.email "12679994+jonw09@users.noreply.github.com"
```

Never put a personal name or email address in a commit or a file.

## Branches

`main` is protected. Never commit to it directly: make every change on a branch and open a pull request into `main`.
