# insta-who-unfollowed-me

Utility to make it easy to track unfollowers on Instagram.

![Alt Text](https://raw.githubusercontent.com/maxgfr/insta-who-unfollowed-me/main/.github/assets/main.gif)

## Features

- 📊 **Track Unfollowers**: Find users who don't follow you back
- 🔐 **Secure**: Supports environment variables for credentials
- 📝 **Multiple Output Formats**: Text and JSON support
- 💾 **Save Results**: Export results to a file
- 📈 **Statistics**: View detailed statistics about your followers
- 🎨 **Color Themes**: Customizable color themes (light, dark, none)
- 🚀 **Fast**: Parallel fetching for better performance
- 🔄 **Retry Logic**: Automatic retry with exponential backoff

## Installation

```bash
npm install -g insta-who-unfollowed-me

# or using npx
npx insta-who-unfollowed-me
```

## Usage

### Interactive Mode

The simplest way to use the tool is in interactive mode:

```bash
insta-who-unfollowed-me
```

You will be prompted to enter your Instagram email and password.

### Command-Line Arguments

You can also provide credentials directly via command-line arguments:

```bash
insta-who-unfollowed-me --email your@email.com --password yourpassword
```

### Environment Variables

For better security, use environment variables:

```bash
export INSTA_EMAIL="your@email.com"
export INSTA_PASSWORD="yourpassword"
insta-who-unfollowed-me
```

## Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--email <email>` | `-e` | Instagram email | Prompt |
| `--username <email>` | `-u` | Instagram email (deprecated: use `--email`) | Prompt |
| `--password <password>` | `-p` | Instagram password | Prompt |
| `--format <format>` | `-f` | Output format (text, json, or csv) | `text` |
| `--output <file>` | `-o` | Save results to file | - |
| `--stats` | `-s` | Show detailed statistics | `false` |
| `--verbose` | `-v` | Enable verbose output | `false` |
| `--limit <number>` | `-l` | Limit the number of results | - |
| `--theme <theme>` | `-t` | Color theme (light, dark, none) | `light` |
| `--no-color` | | Disable colored output | - |
| `--sort <option>` | | Sort results (username, username-desc, random) | - |

## Examples

### Basic Usage

```bash
# Interactive mode
insta-who-unfollowed-me

# With credentials
insta-who-unfollowed-me -e your@email.com -p yourpassword

# With deprecated username option (still works)
insta-who-unfollowed-me -u your@email.com -p yourpassword
```

### Output Formats

```bash
# JSON output
insta-who-unfollowed-me -e your@email.com -p yourpassword -f json

# JSON output with statistics
insta-who-unfollowed-me -e your@email.com -p yourpassword -f json -s

# CSV output
insta-who-unfollowed-me -e your@email.com -p yourpassword -f csv

# CSV output with statistics
insta-who-unfollowed-me -e your@email.com -p yourpassword -f csv -s
```

### Save Results to File

```bash
# Save to JSON file
insta-who-unfollowed-me -e your@email.com -p yourpassword -o results.json

# Save with statistics
insta-who-unfollowed-me -e your@email.com -p yourpassword -o results.json -s
```

### Show Statistics

```bash
# Display detailed statistics
insta-who-unfollowed-me -e your@email.com -p yourpassword -s
```

### Limit Results

```bash
# Limit to first 100 results
insta-who-unfollowed-me -e your@email.com -p yourpassword -l 100
```

### Verbose Mode

```bash
# Enable verbose output for debugging
insta-who-unfollowed-me -e your@email.com -p yourpassword -v
```

### Sort Results

```bash
# Sort by username (alphabetical)
insta-who-unfollowed-me -e your@email.com -p yourpassword --sort username

# Sort by username (reverse alphabetical)
insta-who-unfollowed-me -e your@email.com -p yourpassword --sort username-desc

# Random sort
insta-who-unfollowed-me -e your@email.com -p yourpassword --sort random
```

### Color Themes

```bash
# Light theme (default)
insta-who-unfollowed-me -e your@email.com -p yourpassword -t light

# Dark theme
insta-who-unfollowed-me -e your@email.com -p yourpassword -t dark

# No colors
insta-who-unfollowed-me -e your@email.com -p yourpassword -t none

# Disable colors explicitly
insta-who-unfollowed-me -e your@email.com -p yourpassword --no-color
```

### Combined Options

```bash
# Full example with all options
insta-who-unfollowed-me \
  -e your@email.com \
  -p yourpassword \
  -f json \
  -o results.json \
  -s \
  -v \
  -l 100 \
  -t dark \
  --sort username
```

## Output

### Text Format

```
==================================================
📋 Unfollowers List
==================================================

Found 5 user(s) who don't follow you back:

  1. @user1
  2. @user2
  3. @user3
  4. @user4
  5. @user5

--------------------------------------------------
📊 Statistics
--------------------------------------------------
  Followers:      1000
  Following:      500
  Unfollowers:     5
  Mutual:          495
  Follow Ratio:    2.00
```

### JSON Format

```json
{
  "unfollowers": ["user1", "user2", "user3", "user4", "user5"],
  "stats": {
    "followers": 1000,
    "following": 500,
    "unfollowers": 5,
    "mutual": 495,
    "ratio": 2.0
  }
}
```

### CSV Format

```csv
username,type
user1,unfollower
user2,unfollower
user3,unfollower
user4,unfollower
user5,unfollower
```

## Color Themes

### Light Theme (Default)
- Bright, vibrant colors for better visibility
- Optimized for light terminal backgrounds

### Dark Theme
- Muted, softer colors for dark terminals
- Reduced eye strain in low-light environments

### None
- Plain text output without any colors
- Useful for piping to files or CI/CD environments

## Error Handling

The tool includes comprehensive error handling for common Instagram API issues:

- **Authentication Failed**: Invalid credentials or login issues
- **Rate Limited**: Too many requests, will retry automatically
- **Network Error**: Connection issues, will retry automatically
- **Challenge Required**: Instagram requires you to complete a challenge in your browser
- **Account Locked**: Your account may be locked or disabled

The tool will automatically retry up to 3 times with a 2-second delay between attempts.

## Security

- **Never commit credentials**: Avoid hardcoding passwords in scripts
- **Use environment variables**: Store credentials in environment variables
- **Clear terminal history**: Use `history -c` after running with credentials
- **Use a dedicated account**: Consider using a secondary Instagram account

## Troubleshooting

### "Challenge Required" Error

If you see this error, Instagram requires you to complete a security challenge:

1. Open Instagram in your browser
2. Login to your account
3. Complete any security prompts
4. Try running the tool again

### "Account Locked" Error

If your account appears locked:

1. Contact Instagram support
2. Verify your account information
3. Wait for Instagram to unlock your account

### Rate Limiting

If you're rate-limited:

1. Wait a few minutes before trying again
2. Use the `--limit` option to reduce the number of requests
3. Consider running the tool less frequently

### Colors Not Showing

If colors are not displaying:

1. Check that your terminal supports ANSI colors
2. Use `--theme light` or `--theme dark` explicitly
3. Use `--no-color` to disable colors if preferred
4. Set the `NO_COLOR` environment variable to disable colors globally

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Disclaimer

This tool is for educational purposes only. Use it responsibly and respect Instagram's Terms of Service. The authors are not responsible for any misuse of this tool or any consequences that may arise from its use.