/* eslint-disable indent */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable global-require */
import express from 'express';
import webpack from 'webpack';
import helmet from 'helmet';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { Provider } from 'react-redux';
import { createStore } from 'redux';
import { StaticRouter } from 'react-router-dom';
import { renderRoutes } from 'react-router-config';
import cookieParser from 'cookie-parser';
import boom from '@hapi/boom';
import passport from 'passport';
import axios from 'axios';
import reducer from '../frontend/reducers';
import serverRoutes from '../frontend/routes/serverRoutes';
import getManifest from './getManifest';

const app = express();

const { PORT, ENV } = process.env;

app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());
app.use(passport.session());

require('./utils/auth/strategies/basic');

if (ENV === 'development') {
  console.log('Development config');
  const webpackConfig = require('../../webpack.config');
  const webpackDevMiddleware = require('webpack-dev-middleware');
  const webpackHotMiddleware = require('webpack-hot-middleware');
  const compiler = webpack(webpackConfig);
  const serverConfig = { port: PORT, hot: true };

  app.use(webpackDevMiddleware(compiler, serverConfig));
  app.use(webpackHotMiddleware(compiler));
} else {
  app.use((req, res, next) => {
    if (!req.hashManifest) req.hashManifest = getManifest();
    next();
  });
  app.use(express.static(`${__dirname}/public`));
  app.use(helmet());
  app.use(helmet.permittedCrossDomainPolicies());
  app.disable('x-powered-by');
}

const setResponse = (html, preloadedState, manifest) => {
  const mainStyles = manifest ? manifest['main.css'] : 'assets/app.css';
  const mainBuild = manifest ? manifest['main.js'] : 'assets/app.js';
  const vendorBuild = manifest ? manifest['vendors.js'] : 'assets/vendor.js';

  return `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=z, initial-scale=1.0" />
      <link rel="stylesheet" href=${mainStyles} type="text/css">
      <title>Platzi Video</title>
    </head>
    <body>
      <div id="app">${html}</div>
      <script>
      window.__PRELOADED_STATE__ = ${JSON.stringify(preloadedState).replace(
        /</g,
        '\\u003c',
      )} 
      </script>
      <script src=${mainBuild} type="text/javascript"></script>
      <script src=${vendorBuild} type="text/javascript"></script>
    </body>
  </html>
  `;
};

const renderApp = async (req, res) => {
  let initialState;

  const { token, id, name, email } = req.cookies;

  try {
    let moviesList = await axios({
      url: `${process.env.API_URL}/api/movies`,
      headers: { Authorization: `Bearer ${token}` },
      method: 'GET',
    });

    moviesList = moviesList.data.data;

    initialState = {
      ...initialState,
      user: {
        id,
        name,
        email,
      },
      trends: moviesList.filter(
        movie => movie.contentRating === 'PG' && movie._id,
      ),
      originals: moviesList.filter(
        movie => movie.contentRating === 'G' && movie._id,
      ),
    };
  } catch (error) {
    initialState = {
      ...initialState,
      user: {},
      trends: [],
      originals: [],
    };
  }

  const store = createStore(reducer, initialState);
  const isLogged = initialState.user.id;
  const preloadedState = store.getState();
  const html = renderToString(
    <Provider store={store}>
      <StaticRouter location={req.url} context={{}}>
        {renderRoutes(serverRoutes(isLogged))}
      </StaticRouter>
    </Provider>,
  );

  res.send(setResponse(html, preloadedState, req.hashManifest));
};

app.post('/auth/sign-in', async (req, res, next) => {
  passport.authenticate('basic', (error, data) => {
    try {
      if (error || !data) {
        next(boom.unauthorized());
      }

      req.login(data, { session: false }, async (err) => {
        if (err) {
          next(err);
        }

        const { token, ...user } = data;

        res.cookie('token', token, {
          httpOnly: !(ENV === 'development'),
          secure: !(ENV === 'development'),
        });

        res.status(200).json(user);
      });
    } catch (err) {
      next(err);
    }
  })(req, res, next);
});

app.post('/auth/sign-up', async (req, res, next) => {
  const { body: user } = req;

  try {
    const userData = await axios({
      url: `${process.env.API_URL}/api/auth/sign-up`,
      method: 'post',
      data: {
        email: user.email,
        name: user.name,
        password: user.password,
      },
    });

    res.status(201).json({
      email: req.body.email,
      name: req.body.name,
      id: userData.data.id,
    });
  } catch (error) {
    next(error);
  }
});

app.get('*', renderApp);

app.listen(PORT, (err) => {
  if (err) console.error(err);
  else console.log(`Server running at http://localhost:${PORT}`);
});
