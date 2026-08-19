CREATE DATABASE IF NOT EXISTS dsh_plugin_board
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE dsh_plugin_board;

CREATE TABLE IF NOT EXISTS plugins (
  full_name VARCHAR(200) NOT NULL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  owner VARCHAR(128) NOT NULL,
  url VARCHAR(400) NOT NULL,
  description TEXT NOT NULL,
  stars INT NOT NULL DEFAULT 0,
  forks INT NOT NULL DEFAULT 0,
  created_at VARCHAR(40) NOT NULL DEFAULT '',
  updated_at VARCHAR(40) NOT NULL DEFAULT '',
  language VARCHAR(64) NULL,
  archived TINYINT NOT NULL DEFAULT 0,
  is_fork TINYINT NOT NULL DEFAULT 0,
  heat DOUBLE NOT NULL DEFAULT 0,
  fetched_at DATETIME NOT NULL,
  KEY idx_stars (stars),
  KEY idx_created (created_at),
  KEY idx_heat (heat)
);

CREATE TABLE IF NOT EXISTS recommendations (
  full_name VARCHAR(200) NOT NULL PRIMARY KEY,
  rank_no INT NOT NULL,
  reason VARCHAR(500) NOT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  KEY idx_rank (rank_no)
);

CREATE TABLE IF NOT EXISTS meta (
  k VARCHAR(64) NOT NULL PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clicks (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(200) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  ip VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  KEY idx_window (ip, full_name, kind, created_at),
  KEY idx_rank (kind, full_name)
);

CREATE TABLE IF NOT EXISTS suggestions (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(200) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  ip VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  KEY idx_full_name (full_name),
  KEY idx_status (status),
  KEY idx_ip_created (ip, created_at)
);
